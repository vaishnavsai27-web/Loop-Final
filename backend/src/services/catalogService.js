// Read-side catalogue and search. Everything is a SQL query; nothing is
// filtered from an in-memory array.
const { query, one } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { toSong, withUserFlags } = require('./songMapper');
const { normalise } = require('./moodParser');

/** SQL fragment + params that applies the user's content filter to alias `sc`. */
function contentFilter(user) {
  if (!user) return [' AND sc.explicit = 0', []];
  if (user.contentFilter === 'OFF') return ['', []];
  if (user.contentFilter === 'NO_EXPLICIT') return [' AND sc.explicit = 0', []];
  return [" AND sc.explicit = 0 AND sc.content_rating = 'ALL'", []];
}

async function listSongs(user, { genreId, moodId, languageId, page = 1, pageSize = 24, sort = 'popular' }) {
  const where = ["sc.status = 'ACTIVE'"];
  const params = [];
  if (genreId) { where.push('EXISTS (SELECT 1 FROM song_genres g WHERE g.song_id = sc.song_id AND g.genre_id = ?)'); params.push(genreId); }
  if (moodId) { where.push('EXISTS (SELECT 1 FROM v_current_song_moods m WHERE m.song_id = sc.song_id AND m.mood_id = ? AND m.confidence >= 0.5)'); params.push(moodId); }
  if (languageId === 0) where.push('sc.language_id IS NULL');
  else if (languageId) { where.push('sc.language_id = ?'); params.push(languageId); }
  const [cf] = contentFilter(user);
  const order = { popular: 'sc.popularity DESC, sc.song_id', newest: 'sc.release_year DESC, sc.song_id DESC', title: 'sc.title, sc.song_id' }[sort] || 'sc.popularity DESC';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM v_song_catalog sc WHERE ${where.join(' AND ')}${cf}`, params);
  const rows = await query(`SELECT sc.* FROM v_song_catalog sc WHERE ${where.join(' AND ')}${cf} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]);
  return { total, page, pageSize, songs: await withUserFlags(user?.id, rows.map(toSong)) };
}

async function songDetail(user, songId) {
  const row = await one('SELECT * FROM v_song_catalog WHERE song_id = ?', [songId]);
  if (!row || (row.status !== 'ACTIVE' && !user?.permissions?.has('catalog.write'))) throw ApiError.notFound('Song');
  const [song] = await withUserFlags(user?.id, [toSong(row)]);
  const [moods, stats, credits, genres] = await Promise.all([
    query('SELECT mood_id AS id, mood_name AS name, emoji, color_hex AS color, confidence FROM v_current_song_moods WHERE song_id = ? ORDER BY mood_rank', [songId]),
    one('SELECT * FROM v_song_stats WHERE song_id = ?', [songId]),
    query(`SELECT a.artist_id AS id, a.name, sa.role FROM song_artists sa JOIN artists a ON a.artist_id = sa.artist_id
            WHERE sa.song_id = ? ORDER BY sa.role, sa.credit_order`, [songId]),
    query(`SELECT g.genre_id AS id, g.name, sg.is_primary AS isPrimary FROM song_genres sg JOIN genres g ON g.genre_id = sg.genre_id
            WHERE sg.song_id = ? ORDER BY sg.is_primary DESC`, [songId]),
  ]);
  return {
    ...song, moodsDetailed: moods, credits, genres,
    stats: stats ? { plays: stats.plays, listeners: stats.listeners, likes: stats.likes,
      avgRating: stats.avg_rating, ratingCount: stats.rating_count } : null,
  };
}

async function artistDetail(user, artistId) {
  const a = await one(
    `SELECT a.*, l.name AS language_name, r.name AS region_name, ap.plays_30d, ap.listeners_30d, ap.popularity_rank
       FROM artists a LEFT JOIN languages l ON l.language_id = a.primary_language_id
       LEFT JOIN regions r ON r.region_code = a.region_code
       LEFT JOIN v_artist_popularity ap ON ap.artist_id = a.artist_id
      WHERE a.artist_id = ?`, [artistId]);
  if (!a) throw ApiError.notFound('Artist');
  const [cf] = contentFilter(user);
  const songs = await query(
    `SELECT sc.* FROM v_song_catalog sc WHERE sc.status = 'ACTIVE' AND (sc.artist_id = ?
        OR sc.song_id IN (SELECT song_id FROM song_artists WHERE artist_id = ?))${cf}
      ORDER BY sc.popularity DESC`, [artistId, artistId]);
  const aliases = await query('SELECT alias, alias_type AS type FROM artist_aliases WHERE artist_id = ? ORDER BY alias_type, alias', [artistId]);
  return {
    id: a.artist_id, name: a.name, type: a.artist_type, country: a.country_code, region: a.region_name, language: a.language_name,
    formedYear: a.formed_year, bio: a.bio, aliases, popularity: { plays30d: a.plays_30d, listeners30d: a.listeners_30d, rank: a.popularity_rank },
    songs: await withUserFlags(user?.id, songs.map(toSong)),
  };
}

/** Genre tree via a recursive CTE (path + depth), with per-genre statistics. */
async function genreTree() {
  return query(
    `WITH RECURSIVE tree AS (
       SELECT genre_id, name, parent_genre_id, color_hex, 0 AS depth, CAST(name AS CHAR(300)) AS path
         FROM genres WHERE parent_genre_id IS NULL
       UNION ALL
       SELECT g.genre_id, g.name, g.parent_genre_id, g.color_hex, t.depth + 1, CONCAT(t.path, ' › ', g.name)
         FROM genres g JOIN tree t ON g.parent_genre_id = t.genre_id
     )
     SELECT t.genre_id AS id, t.name, t.parent_genre_id AS parentId, t.color_hex AS color, t.depth, t.path,
            gs.songs, gs.plays, gs.avg_rating AS avgRating, gs.avg_energy AS avgEnergy
       FROM tree t JOIN v_genre_statistics gs ON gs.genre_id = t.genre_id
      ORDER BY t.path`);
}

async function moods() {
  return query(
    `SELECT m.mood_id AS id, m.name, m.emoji, m.color_hex AS color, m.description, mc.name AS category, mc.quadrant,
            m.target_energy AS energy, m.target_valence AS valence, m.tempo_min AS tempoMin, m.tempo_max AS tempoMax,
            (SELECT COUNT(*) FROM v_current_song_moods cm WHERE cm.mood_id = m.mood_id AND cm.confidence >= 0.5) AS songs
       FROM moods m JOIN mood_categories mc ON mc.category_id = m.category_id ORDER BY mc.category_id, m.mood_id`);
}

async function contexts() {
  return query(`SELECT context_id AS id, code, name, emoji, description FROM contexts ORDER BY sort_order`);
}

async function languages() {
  return query(`SELECT l.language_id AS id, l.iso_code AS iso, l.name, l.native_name AS nativeName, l.script,
                       (SELECT COUNT(*) FROM songs s WHERE s.language_id = l.language_id AND s.status = 'ACTIVE') AS songs
                  FROM languages l ORDER BY l.name`);
}

/** Share of the query's letter pairs found in `text` (0–1). Filters ngram noise. */
function coverage(q, text) {
  const pairs = (t) => { const x = normalise(String(t || '')).replace(/\s+/g, ''); const out = new Set(); for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2)); return out; };
  const qp = pairs(q);
  if (!qp.size) return 0;
  const tp = pairs(text);
  let hit = 0;
  qp.forEach((p) => { if (tp.has(p)) hit += 1; });
  return hit / qp.size;
}
const FUZZY_MIN = 0.6;

/**
 * Search across songs, artists (incl. aliases and sound-alike names), albums,
 * moods, genres and languages. Uses ngram FULLTEXT indexes so partial and
 * slightly misspelled words still match ("venela" finds "Vennela").
 */
async function search(user, q, { recordHistory = true } = {}) {
  const norm = normalise(q);
  if (norm.length < 2) throw ApiError.badRequest('Type at least 2 characters.');
  const like = `%${norm.replace(/[%_\\]/g, '\\$&')}%`;
  const prefix = `${norm.replace(/[%_\\]/g, '\\$&')}%`;
  const [cf] = contentFilter(user);

  const [artistsAll, moodsHit, genresHit, langs, albumsAll] = await Promise.all([
    query(
      `SELECT a.artist_id AS id, a.name, a.artist_type AS type, l.name AS language,
              MAX(GREATEST(MATCH(a.name) AGAINST (? IN NATURAL LANGUAGE MODE),
                           COALESCE(MATCH(al.alias) AGAINST (? IN NATURAL LANGUAGE MODE), 0))) AS relevance,
              MAX(a.normalized_name LIKE ? OR al.normalized_alias LIKE ?) AS prefix_hit,
              MAX(SOUNDEX(a.name) = SOUNDEX(?)) AS sounds_like,
              GROUP_CONCAT(DISTINCT CASE WHEN al.normalized_alias LIKE ? THEN al.alias END) AS matched_alias,
              GROUP_CONCAT(DISTINCT al.alias SEPARATOR '|') AS aliases
         FROM artists a
         LEFT JOIN artist_aliases al ON al.artist_id = a.artist_id
         LEFT JOIN languages l ON l.language_id = a.primary_language_id
        WHERE MATCH(a.name) AGAINST (? IN NATURAL LANGUAGE MODE)
           OR MATCH(al.alias) AGAINST (? IN NATURAL LANGUAGE MODE)
           OR a.normalized_name LIKE ? OR al.normalized_alias LIKE ?
           OR SOUNDEX(a.name) = SOUNDEX(?)
        GROUP BY a.artist_id, a.name, a.artist_type, l.name
        ORDER BY prefix_hit DESC, relevance DESC LIMIT 20`,
      [norm, norm, prefix, prefix, norm, like, norm, norm, like, like, norm]),
    query(`SELECT mood_id AS id, name, emoji, color_hex AS color, description FROM moods WHERE name LIKE ? OR description LIKE ? LIMIT 5`, [like, like]),
    query(`SELECT genre_id AS id, name, color_hex AS color FROM genres WHERE name LIKE ? LIMIT 5`, [like]),
    query(`SELECT language_id AS id, name, native_name AS nativeName FROM languages WHERE name LIKE ? OR native_name LIKE ? OR iso_code = ? LIMIT 3`, [like, like, norm]),
    query(`SELECT al.album_id AS id, al.title, al.album_type AS type, al.cover_color_1 AS c1, al.cover_color_2 AS c2, a.name AS artist
             FROM albums al JOIN album_artists aa ON aa.album_id = al.album_id AND aa.credit_order = 1
             JOIN artists a ON a.artist_id = aa.artist_id
            WHERE MATCH(al.title) AGAINST (? IN NATURAL LANGUAGE MODE) OR al.normalized_title LIKE ? LIMIT 20`, [norm, like]),
  ]);
  // ngram FULLTEXT matches any shared letter pair; keep only real hits:
  // substring, alias, sound-alike, or most of the query's letter pairs present.
  const artists = artistsAll.filter((a) => a.prefix_hit || a.matched_alias || a.sounds_like
    || normalise(a.name).includes(norm) || Math.max(coverage(norm, a.name), ...String(a.aliases || '').split('|').map((x) => coverage(norm, x))) >= FUZZY_MIN).slice(0, 8);
  const albums = albumsAll.filter((x) => normalise(x.title).includes(norm) || coverage(norm, x.title) >= FUZZY_MIN).slice(0, 6);

  const artistIds = artists.map((a) => a.id);
  const moodIds = moodsHit.map((m) => m.id);
  const genreIds = genresHit.map((g) => g.id);
  const langIds = langs.map((l) => l.id);
  const songRows = await query(
    `SELECT sc.*,
            MATCH(s.title) AGAINST (? IN NATURAL LANGUAGE MODE) * 2
          + (s.normalized_title LIKE ?) * 3
          + (sc.artist_id IN (?)) * 1.5
          + COALESCE((SELECT MAX(cm.confidence) FROM v_current_song_moods cm WHERE cm.song_id = sc.song_id AND cm.mood_id IN (?)), 0)
          + (sc.genre_id IN (?)) * 0.8 + (sc.language_id IN (?)) * 0.6 AS relevance,
            (s.normalized_title LIKE ?) AS by_like,
            (sc.artist_id IN (?) OR sc.genre_id IN (?) OR sc.language_id IN (?)
              OR EXISTS (SELECT 1 FROM v_current_song_moods cm WHERE cm.song_id = sc.song_id AND cm.mood_id IN (?) AND cm.confidence >= 0.6)
              OR sc.album_id IN (SELECT album_id FROM albums WHERE normalized_title LIKE ?)) AS by_other
       FROM v_song_catalog sc JOIN songs s ON s.song_id = sc.song_id
      WHERE sc.status = 'ACTIVE'${cf}
        AND ( MATCH(s.title) AGAINST (? IN NATURAL LANGUAGE MODE) OR s.normalized_title LIKE ?
              OR sc.artist_id IN (?) OR sc.genre_id IN (?) OR sc.language_id IN (?)
              OR EXISTS (SELECT 1 FROM v_current_song_moods cm WHERE cm.song_id = sc.song_id AND cm.mood_id IN (?) AND cm.confidence >= 0.6)
              OR sc.album_id IN (SELECT album_id FROM albums WHERE normalized_title LIKE ?) )
      ORDER BY relevance DESC, sc.popularity DESC LIMIT 60`,
    [norm, prefix, artistIds.length ? artistIds : [0], moodIds.length ? moodIds : [0], genreIds.length ? genreIds : [0],
      langIds.length ? langIds : [0],
      like, artistIds.length ? artistIds : [0], genreIds.length ? genreIds : [0], langIds.length ? langIds : [0], moodIds.length ? moodIds : [0], like,
      norm, like, artistIds.length ? artistIds : [0], genreIds.length ? genreIds : [0],
      langIds.length ? langIds : [0], moodIds.length ? moodIds : [0], like]);

  const songs = songRows.filter((r) => r.by_like || r.by_other || coverage(norm, r.title) >= FUZZY_MIN).slice(0, 24);
  const total = songs.length + artists.length + albums.length + moodsHit.length + genresHit.length + langs.length;
  if (recordHistory && user) {
    await query('INSERT INTO search_history (user_id, query_text, normalized_query, result_count) VALUES (?, ?, ?, ?)',
      [user.id, q.slice(0, 120), norm.slice(0, 120), Math.min(total, 65535)]);
  }
  return {
    query: q, normalised: norm, total,
    songs: await withUserFlags(user?.id, songs.map((r) => ({ ...toSong(r), relevance: Math.round(r.relevance * 100) / 100 }))),
    artists: artists.map((a) => ({ id: a.id, name: a.name, type: a.type, language: a.language, matchedAlias: a.matched_alias,
      soundsLike: !!a.sounds_like && !a.prefix_hit && a.relevance === 0 })),
    albums, moods: moodsHit, genres: genresHit, languages: langs,
  };
}

async function albumDetail(user, albumId) {
  const a = await one(
    `SELECT al.*, f.title AS film_title, l.name AS language_name FROM albums al
       LEFT JOIN films f ON f.film_id = al.film_id LEFT JOIN languages l ON l.language_id = al.language_id
      WHERE al.album_id = ?`, [albumId]);
  if (!a) throw ApiError.notFound('Album');
  const [cf] = contentFilter(user);
  const [artists, songs] = await Promise.all([
    query(`SELECT ar.artist_id AS id, ar.name FROM album_artists aa JOIN artists ar ON ar.artist_id = aa.artist_id
            WHERE aa.album_id = ? ORDER BY aa.credit_order`, [albumId]),
    query(`SELECT sc.*, s.track_number FROM v_song_catalog sc JOIN songs s ON s.song_id = sc.song_id
            WHERE sc.album_id = ? AND sc.status = 'ACTIVE'${cf} ORDER BY s.track_number, sc.song_id`, [albumId]),
  ]);
  return { id: a.album_id, title: a.title, type: a.album_type, releaseYear: a.release_year, film: a.film_title, filmId: a.film_id, language: a.language_name,
    cover: [a.cover_color_1, a.cover_color_2], artists,
    artworkUrl: null,
    songs: await withUserFlags(user?.id, songs.map((r) => ({ ...toSong(r), trackNumber: r.track_number }))) };
}

module.exports = { albumDetail, listSongs, songDetail, artistDetail, genreTree, moods, contexts, languages, search, contentFilter };
