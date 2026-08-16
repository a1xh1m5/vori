/*
 * 8Spine Engine Audio Resolver Module (v1.0.0)
 * 
 * Target Endpoints:
 * - Search:   https://search.alxhlms.workers.dev
 * - Playback: https://playback.alxhlms.workers.dev
 */

var SEARCH_ENDPOINT = "https://search.alxhlms.workers.dev";
var PLAYBACK_ENDPOINT = "https://playback.alxhlms.workers.dev";

var searchCache = {};
var pendingSearches = {};
var trackMap = {};

function mapQualityCode(inputQuality) {
  var q = String(inputQuality || "").toUpperCase();
  if (q.indexOf("FLAC") !== -1 || q.indexOf("LOSSLESS") !== -1) return "lossless";
  if (q.indexOf("LOW") !== -1 || q.indexOf("HEAAC") !== -1) return "low";
  return "high";
}

function generateQualityLabel(qualityKey) {
  switch (qualityKey) {
    case "lossless":
      return "LOSSLESS 16-bit / 44.1 kHz";
    case "low":
      return "AAC 96kbps";
    case "high":
    default:
      return "AAC 320kbps";
  }
}

function extractItems(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.items)) return res.items;
  if (Array.isArray(res.tracks)) return res.tracks;
  if (Array.isArray(res.results)) return res.results;
  if (res.data && Array.isArray(res.data.items)) return res.data.items;
  if (res.data && Array.isArray(res.data.tracks)) return res.data.tracks;
  return [];
}

function transformTrackPayload(rawItem, qualitySetting) {
  var qKey = mapQualityCode(qualitySetting);

  var artistName = "Unknown Artist";
  if (typeof rawItem.artist === "string") artistName = rawItem.artist;
  else if (rawItem.artist && typeof rawItem.artist.name === "string") artistName = rawItem.artist.name;
  else if (rawItem.artistName) artistName = rawItem.artistName;
  else if (Array.isArray(rawItem.artists) && rawItem.artists.length > 0) {
    artistName = rawItem.artists.map(function(a) { return a.name || a; }).join(", ");
  }

  var albumName = "";
  if (typeof rawItem.album === "string") albumName = rawItem.album;
  else if (rawItem.album && typeof rawItem.album.title === "string") albumName = rawItem.album.title;
  else if (rawItem.albumName) albumName = rawItem.albumName;

  var albumCover = rawItem.albumCover || rawItem.cover || null;
  if (!albumCover && rawItem.album) {
    albumCover = rawItem.album.cover_xl || rawItem.album.cover_big || rawItem.album.cover_medium || rawItem.album.cover || null;
  }

  var trackId = String(rawItem.id || rawItem.trackId || rawItem.isrc || "");

  var transformed = {
    id: trackId,
    isrc: rawItem.isrc || null,
    title: rawItem.title || rawItem.name || rawItem.trackName || rawItem.title_short || "Unknown Track",
    artist: artistName,
    album: albumName,
    albumCover: albumCover,
    duration: Number(rawItem.duration) || 0,
    trackNumber: rawItem.trackNumber || rawItem.track_number || 1,
    audioQuality: generateQualityLabel(qKey),
  };

  if (trackId) {
    trackMap[trackId] = transformed;
  }

  return transformed;
}

async function searchTracks(query, limit, context) {
  if (!limit) limit = 15;

  var cacheKey = query + "_" + limit;
  if (searchCache[cacheKey]) return searchCache[cacheKey];
  if (pendingSearches[cacheKey]) return pendingSearches[cacheKey];

  var selectedQuality = context?.settings?.audioQuality?.value || "FLAC";
  var mappedQualityParam = mapQualityCode(selectedQuality);
  var requestUrl = SEARCH_ENDPOINT + "/search?q=" + encodeURIComponent(query) + "&quality=" + encodeURIComponent(mappedQualityParam);

  pendingSearches[cacheKey] = (async function() {
    try {
      var res = await fetch(requestUrl);
      if (!res.ok) throw new Error("Search failed with status " + res.status);

      var body = await res.json();
      var rawTracks = extractItems(body);

      var formattedTracks = rawTracks.slice(0, limit).map(function(track) {
        return transformTrackPayload(track, selectedQuality);
      });

      var responsePayload = { tracks: formattedTracks, total: formattedTracks.length };
      searchCache[cacheKey] = responsePayload;
      return responsePayload;
    } finally {
      delete pendingSearches[cacheKey];
    }
  })();

  return pendingSearches[cacheKey];
}

async function getTrackStreamUrl(trackId, preferredQuality, context) {
  if (!trackId) throw new Error("Valid track ID required for stream resolution");

  var targetQuality = preferredQuality || context?.settings?.audioQuality?.value || "FLAC";
  var qualityKey = mapQualityCode(targetQuality);
  var strTrackId = String(trackId);

  var directStreamUrl = PLAYBACK_ENDPOINT + "/stream?i=" + encodeURIComponent(strTrackId) + "&quality=" + encodeURIComponent(qualityKey);

  var cachedTrack = trackMap[strTrackId];

  return {
    streamUrl: directStreamUrl,
    track: {
      id: strTrackId,
      title: cachedTrack?.title || "Unknown Track",
      artist: cachedTrack?.artist || "Unknown Artist",
      album: cachedTrack?.album || "",
      albumCover: cachedTrack?.albumCover || null,
      duration: cachedTrack?.duration || 0,
      audioQuality: generateQualityLabel(qualityKey),
      bitDepth: 16,
      sampleRate: 44.1,
      mimeType: "application/x-mpegURL",
    },
  };
}

return {
  id: "vori",
  name: "vori",
  author: "alxhlms",
  version: "1.0.0",
  description: "Port of vori.alxhlms.workers.dev to 8spine, open-beta, high-latency",
  settings: {
    audioQuality: {
      type: "selector",
      label: "Streaming Audio Quality",
      description: "Default audio target quality for stream resolution",
      options: [
        { label: "Lossless (FLAC 16-bit / 44.1 kHz)", value: "FLAC" },
        { label: "High Quality (AAC 320kbps)", value: "AACLC" },
        { label: "Low Quality (AAC 96kbps)", value: "HEAACV1" },
      ],
      defaultValue: "FLAC",
    },
  },
  searchTracks: searchTracks,
  getTrackStreamUrl: getTrackStreamUrl,
};
