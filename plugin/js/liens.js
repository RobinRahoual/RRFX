/* RR FX : importer une vidéo ou un son depuis un lien. Un lien direct vers un fichier (.mp4,
   .mp3, .wav…, Dropbox, Google Drive) est téléchargé tel quel ; un lien de plateforme (YouTube,
   Vimeo, SoundCloud…) passe par yt-dlp, l'outil gratuit que l'utilisateur installe lui-même.
   Ici : la partie sans Premiere ni réseau (type de lien, commande, noms de fichiers). Testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXLiens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VIDEO = ['mp4', 'mov', 'm4v', 'webm', 'mkv'];
  const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'aif', 'aiff', 'flac', 'ogg'];
  const PLATFORMS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com|dailymotion\.com|tiktok\.com|instagram\.com|twitch\.tv|bandcamp\.com|facebook\.com|x\.com|twitter\.com)$/i;

  /* Lien → { ok, kind: 'direct' | 'platform', url, ext, host } ou { ok: false, why }. Les liens
     de partage Dropbox et Google Drive sont convertis en lien de téléchargement direct. */
  function classify(text) {
    let u;
    try { u = new URL(String(text || '').trim()); } catch (e) { return { ok: false, why: 'Ce n\'est pas un lien (il doit commencer par https://).' }; }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, why: 'Seuls les liens http(s) sont acceptés.' };
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (/(^|\.)dropbox\.com$/.test(host)) {
      u.searchParams.set('dl', '1');
      const ext = extOf(u.pathname);
      return { ok: true, kind: 'direct', url: u.toString(), ext, host };
    }
    const drive = /(^|\.)drive\.google\.com$/.test(host) && (/\/file\/d\/([\w-]+)/.exec(u.pathname) || [null, u.searchParams.get('id')]);
    if (drive && drive[1]) return { ok: true, kind: 'direct', url: 'https://drive.google.com/uc?export=download&id=' + drive[1], ext: '', host };
    if (PLATFORMS.test(host)) return { ok: true, kind: 'platform', url: u.toString(), ext: '', host };
    const ext = extOf(u.pathname);
    if (VIDEO.concat(AUDIO).indexOf(ext) >= 0) return { ok: true, kind: 'direct', url: u.toString(), ext, host };
    return { ok: false, why: 'Ce lien ne mène pas à une vidéo ou un son (.mp4, .mp3, .wav…) ni à une plateforme reconnue.' };
  }

  function extOf(p) { const m = /\.([a-z0-9]{2,5})$/i.exec(String(p || '')); return m ? m[1].toLowerCase() : ''; }
  const isAudio = ext => AUDIO.indexOf(String(ext || '').toLowerCase()) >= 0;
  const isVideo = ext => VIDEO.indexOf(String(ext || '').toLowerCase()) >= 0;

  /* Nom de fichier sûr (Windows et Mac), 80 caractères au plus. */
  function safeName(s, fallback) {
    const t = String(s || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
    return t || fallback || 'import';
  }
  /* Nom pour un lien direct : la fin du chemin, décodée. */
  function nameFromUrl(url, ext) {
    let base = '';
    try { base = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (e) { base = ''; }
    base = base.replace(/\.[a-z0-9]{2,5}$/i, '');
    return safeName(base, 'import') + (ext ? '.' + ext : '');
  }

  /* Arguments de yt-dlp. mode : video (MP4) | audio (MP3 si ffmpeg est là, sinon M4A) ;
     out : dossier ; ffmpeg : chemin de ffmpeg ou ''. Le chemin final est imprimé en dernier. */
  function ytdlpArgs(o) {
    const args = ['--no-playlist', '--newline', '--no-mtime', '--restrict-filenames', '-o', o.out.replace(/[\\/]+$/, '') + '/%(title).70s [%(id)s].%(ext)s', '--print', 'after_move:filepath', '--progress'];
    if (o.ffmpeg) args.push('--ffmpeg-location', o.ffmpeg);
    if (o.mode === 'audio') {
      if (o.ffmpeg) args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
      else args.push('-f', 'ba[ext=m4a]/ba');
    } else if (o.ffmpeg) args.push('-f', 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4');
    else args.push('-f', 'b[ext=mp4]/b');
    args.push('--', o.url);
    return args;
  }

  /* Progression d'une ligne de yt-dlp (« [download]  42.3% of … ») → 0 à 1, ou null. */
  function progressOf(line) {
    const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(String(line || ''));
    return m ? Math.min(1, +m[1] / 100) : null;
  }

  /* Où chercher yt-dlp et ffmpeg quand ils ne sont pas dans le PATH. */
  function candidates(tool, platform, env) {
    const e = env || {}, exe = platform === 'win32' ? tool + '.exe' : tool;
    if (platform === 'win32') {
      const local = e.LOCALAPPDATA || '', user = e.USERPROFILE || '';
      return [
        local && local + '\\Microsoft\\WinGet\\Links\\' + exe,
        user && user + '\\scoop\\shims\\' + exe,
        'C:\\ProgramData\\chocolatey\\bin\\' + exe,
        user && user + '\\Downloads\\' + exe,
        user && user + '\\Documents\\RRFX\\Outils\\' + exe
      ].filter(Boolean);
    }
    const home = e.HOME || '';
    return ['/opt/homebrew/bin/' + exe, '/usr/local/bin/' + exe, '/usr/bin/' + exe, home && home + '/.local/bin/' + exe, home && home + '/Documents/RRFX/Outils/' + exe].filter(Boolean);
  }

  return { VIDEO, AUDIO, classify, extOf, isAudio, isVideo, safeName, nameFromUrl, ytdlpArgs, progressOf, candidates };
});
