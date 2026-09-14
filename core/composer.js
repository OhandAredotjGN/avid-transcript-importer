/* Shared preparation for browser preview and DOCX. Parser functions come from Code.gs. */
(function (root) {
  const MAX_FILES = 50;
  const MAX_CHARACTERS = 5_000_000;
  function compose(files, options = {}) {
    if (!Array.isArray(files) || !files.length || files.length > MAX_FILES)
      throw new Error(`Choose between 1 and ${MAX_FILES} transcript files.`);
    if (files.some(f => typeof f.name !== 'string' || typeof f.content !== 'string'))
      throw new Error('Each transcript needs a filename and text.');
    if (files.reduce((n, f) => n + f.content.length, 0) > MAX_CHARACTERS)
      throw new Error('Choose a smaller batch (up to 5 million characters).');
    const cleanMode = options.cleanMode || 'balanced';
    const cleaners = {light: lightCleanClientText_, balanced: balancedCleanClientText_, aggressive: aggressiveCleanClientText_};
    if (!Object.hasOwn(cleaners, cleanMode)) throw new Error('Choose a supported cleanup mode.');
    const documents = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', {numeric:true, sensitivity:'base'})).map(file => {
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(file.content))
        throw new Error(`${file.name}: use a UTF-8 text export without control characters.`);
      const parsed = parseTranscript_(file.content);
      const blocks = parsed.blocks.map(b => ({
        speaker:normalizeSpeakerForClient_(b.speaker), timestamp:b.timestamp,
        text:cleaners[cleanMode](b.text)
      })).filter(b => b.text.trim());
      if (!blocks.length) throw new Error(`${file.name}: no dialogue remains after cleanup.`);
      return {sourceFile:file.name, title:cleanTitle_(parsed.clipName || file.name), project:parsed.project, clipName:parsed.clipName, blocks, report:preflightTranscriptFiles([file])[0]};
    });
    return {schemaVersion:1, options:{cleanMode, showTimestamps:!!options.showTimestamps, includeMeta:!!options.includeMeta, includeImportLog:!!options.includeImportLog}, documents};
  }
  root.TranscriptComposer = {compose, MAX_FILES, MAX_CHARACTERS};
})(globalThis);
