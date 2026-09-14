function onOpen() {
  DocumentApp.getUi()
    .createMenu('Transcript Import')
    .addItem('Import Avid Transcript(s)', 'showTranscriptImporter')
    .addToUi();
}

function showTranscriptImporter() {
  const html = HtmlService
    .createHtmlOutputFromFile('ImporterDialog')
    .setWidth(760)
    .setHeight(680);

  DocumentApp.getUi().showModalDialog(html, 'Import Avid Transcript(s)');
}

/**
 * Called from the modal after files are read in-browser.
 *
 * @param {Array<{name:string, content:string}>} files
 * @return {Array<Object>}
 */
function preflightTranscriptFiles(files) {
  if (!files || !files.length) {
    throw new Error('No files provided.');
  }

  return files.map(function(file) {
    const raw = normalizeText_(file.content || '');
    const parsed = parseTranscript_(raw);
    const lines = raw.split('\n');

    const report = {
      name: file.name,
      status: 'Importable',
      warnings: [],
      stats: {
        lines: lines.length,
        characters: raw.length,
        speakerTurns: parsed.blocks.length,
        timestamps: 0,
        duplicateTimestamps: 0,
        angleBracketMarkers: 0,
        possibleInlineSpeakers: 0,
        possibleMalformedSpeakers: 0,
        orphanTextBeforeSpeaker: 0,
        veryLongBlocks: 0,
        removedArtifactsEstimate: 0
      }
    };

    const timestampCounts = {};
    let hasSeenSpeaker = false;

    lines.forEach(function(line) {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (isMetadataLine_(trimmed)) return;

      if (isTimestamp_(trimmed)) {
        report.stats.timestamps++;
        timestampCounts[trimmed] = (timestampCounts[trimmed] || 0) + 1;
        return;
      }

      const isSpeaker = isSpeakerLine_(trimmed);
      const isInlineSpeaker = isInlineSpeakerLine_(trimmed);

      if (isSpeaker || isInlineSpeaker) {
        hasSeenSpeaker = true;
      }

      if (!hasSeenSpeaker && !isMetadataLine_(trimmed)) {
        report.stats.orphanTextBeforeSpeaker++;
      }

      if (/<[^>]+>/.test(trimmed)) {
        report.stats.angleBracketMarkers++;
      }

      if (isInlineSpeaker) {
        report.stats.possibleInlineSpeakers++;
      }

      if (/:$/.test(trimmed) && !isSpeaker) {
        report.stats.possibleMalformedSpeakers++;
      }

      const artifactMatches = trimmed.match(/<[^>]+>|\b(um|uh|erm)\b|\.\.\./gi);
      if (artifactMatches) {
        report.stats.removedArtifactsEstimate += artifactMatches.length;
      }
    });

    Object.keys(timestampCounts).forEach(function(ts) {
      if (timestampCounts[ts] > 1) {
        report.stats.duplicateTimestamps += timestampCounts[ts] - 1;
      }
    });

    parsed.blocks.forEach(function(block) {
      if ((block.text || '').length > 1200) {
        report.stats.veryLongBlocks++;
      }
    });

    if (!parsed.project) {
      report.warnings.push('Missing Project line.');
    }

    if (!parsed.clipName) {
      report.warnings.push('Missing Clip Name line.');
    }

    if (!parsed.blocks.length) {
      report.status = 'Problem';
      report.warnings.push('No speaker turns were parsed.');
    }

    if (report.stats.orphanTextBeforeSpeaker > 0) {
      report.warnings.push(
        report.stats.orphanTextBeforeSpeaker + ' text line(s) found before the first speaker.'
      );
    }

    if (report.stats.possibleInlineSpeakers > 0) {
      report.warnings.push(
        report.stats.possibleInlineSpeakers + ' inline speaker line(s) detected and supported.'
      );
    }

    if (report.stats.possibleMalformedSpeakers > 0) {
      report.warnings.push(
        report.stats.possibleMalformedSpeakers + ' possible malformed speaker label(s).'
      );
    }

    if (report.stats.duplicateTimestamps > 0) {
      report.warnings.push(
        report.stats.duplicateTimestamps + ' duplicate timestamp entr' +
        (report.stats.duplicateTimestamps === 1 ? 'y' : 'ies') + '.'
      );
    }

    if (report.stats.angleBracketMarkers > 0) {
      report.warnings.push(
        report.stats.angleBracketMarkers + ' angle-bracket transcript marker line(s), such as <laugh>.'
      );
    }

    if (report.stats.veryLongBlocks > 0) {
      report.warnings.push(
        report.stats.veryLongBlocks + ' unusually long dialogue block(s).'
      );
    }

    if (report.warnings.length && report.status !== 'Problem') {
      report.status = 'Importable with warnings';
    }

    return report;
  });
}

/**
 * Imports dropped TXT files into the active Google Doc.
 *
 * @param {Array<{name:string, content:string}>} files
 * @param {Object} options
 * @return {{count:number, message:string}}
 */
function importClientTranscripts(files, options) {
  if (!files || !files.length) {
    throw new Error('No transcript files were provided.');
  }

  options = options || {};

  files.sort(function(a, b) {
    return String(a.name).localeCompare(String(b.name), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });

  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  if (options.clearDocument) {
    body.clear();
  }

  files.forEach(function(file, index) {
    const parsed = parseTranscript_(file.content || '');
    const title = parsed.clipName || file.name.replace(/\.txt$/i, '');

    if (index > 0 || (!options.clearDocument && body.getText().trim())) {
      body.appendPageBreak();
    }

    writeClientTranscript_(body, title, parsed, file.name, options);
  });

  if (options.includeImportLog) {
    appendImportLog_(body, files);
  }

  doc.saveAndClose();

  return {
    count: files.length,
    message: 'Imported ' + files.length + ' transcript file' + (files.length === 1 ? '' : 's') + '.'
  };
}

/**
 * Parses transcript formats:
 *
 * Format A:
 * 00:20
 * RACHEL:
 * Dialogue...
 *
 * Format B:
 * RACHEL:
 * 10:54:43:23 - 10:54:48:01
 * Dialogue...
 *
 * Format C:
 * RACHEL: Dialogue...
 */
function parseTranscript_(raw) {
  raw = normalizeText_(raw);

  const lines = raw.split('\n');
  let project = '';
  let clipName = '';

  const blocks = [];
  let current = null;
  let pendingTimestamp = '';

  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    const projectMatch = trimmed.match(/^Project:\s*\[(.*?)\]\s*$/i);
    if (projectMatch) {
      project = projectMatch[1].trim();
      return;
    }

    const clipMatch = trimmed.match(/^Clip Name:\s*\[(.*?)\]\s*$/i);
    if (clipMatch) {
      clipName = clipMatch[1].trim();
      return;
    }

    /**
     * Timestamp / timecode handling.
     *
     * Supports:
     * - 00:20
     * - 01:02:03
     * - 10:54:43:23
     * - 10:54:43:23 - 10:54:48:01
     *
     * If a speaker was just opened and has no text yet,
     * attach the timestamp to that speaker block.
     * Otherwise, hold it for the next speaker.
     */
    if (isTimestamp_(trimmed)) {
      if (current && !current.text && !current.timestamp) {
        current.timestamp = trimmed;
      } else {
        pendingTimestamp = trimmed;
      }
      return;
    }

    /**
     * Inline format:
     * RACHEL: Dialogue text here.
     */
    const inlineSpeaker = !isSpeakerLine_(trimmed) && trimmed.match(/^(.{1,80}?):\s+(.+)$/);
    if (inlineSpeaker && looksLikeSpeakerLabel_(inlineSpeaker[1])) {
      if (current) blocks.push(current);

      current = {
        timestamp: pendingTimestamp,
        speaker: cleanSpeaker_(inlineSpeaker[1]),
        text: inlineSpeaker[2].trim()
      };

      pendingTimestamp = '';
      return;
    }

    /**
     * Speaker-only line:
     * RACHEL:
     */
    if (isSpeakerLine_(trimmed)) {
      if (current) blocks.push(current);

      current = {
        timestamp: pendingTimestamp,
        speaker: cleanSpeaker_(trimmed.replace(/:$/, '')),
        text: ''
      };

      pendingTimestamp = '';
      return;
    }

    /**
     * Dialogue continuation.
     */
    if (!current) {
      current = {
        timestamp: pendingTimestamp,
        speaker: 'Transcript',
        text: ''
      };
      pendingTimestamp = '';
    }

    current.text += (current.text ? ' ' : '') + trimmed;
  });

  if (current) blocks.push(current);

  return {
    project: project,
    clipName: clipName,
    blocks: mergeSameSpeakerBlocks_(blocks)
  };
}

function writeClientTranscript_(body, title, parsed, sourceFileName, options) {
  const showTimestamps = !!options.showTimestamps;
  const includeMeta = !!options.includeMeta;
  const cleanMode = options.cleanMode || 'balanced';

  const titlePara = body.appendParagraph(cleanTitle_(title));
  titlePara.setHeading(DocumentApp.ParagraphHeading.TITLE);
  titlePara.setFontFamily('Arial');
  titlePara.setForegroundColor('#1f4e79');
  titlePara.setSpacingAfter(4);

  const subtitle = body.appendParagraph('Client Review Transcript');
  subtitle.setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
  subtitle.setFontFamily('Arial');
  subtitle.setForegroundColor('#666666');
  subtitle.setSpacingAfter(12);

  if (includeMeta) {
    const metaLines = [];
    if (parsed.project) metaLines.push('Project: ' + parsed.project);
    if (parsed.clipName) metaLines.push('Clip: ' + parsed.clipName);
    metaLines.push('Source file: ' + sourceFileName);

    const meta = body.appendParagraph(metaLines.join('\n'));
    meta.setFontFamily('Arial');
    meta.setFontSize(9);
    meta.setForegroundColor('#777777');
    meta.setSpacingAfter(16);
  }

  const sectionTitle = body.appendParagraph('Transcript');
  sectionTitle.setFontFamily('Arial');
  sectionTitle.setFontSize(10);
  sectionTitle.setBold(true);
  sectionTitle.setForegroundColor('#6d7782');
  sectionTitle.setSpacingBefore(8);
  sectionTitle.setSpacingAfter(10);

  parsed.blocks.forEach(function(block) {
    let text = block.text || '';

    if (cleanMode === 'light') {
      text = lightCleanClientText_(text);
    } else if (cleanMode === 'balanced') {
      text = balancedCleanClientText_(text);
    } else if (cleanMode === 'aggressive') {
      text = aggressiveCleanClientText_(text);
    } else {
      text = lightCleanClientText_(text);
    }

    if (!text.trim()) return;

    appendSpeakerTurn_(body, block.speaker, text, block.timestamp, showTimestamps);
  });
}

/**
 * Uses a one-cell borderless table for each speaker turn.
 * This helps keep speaker name + dialogue together across page breaks.
 */
function appendSpeakerTurn_(body, speaker, text, timestamp, showTimestamp) {
  let label = normalizeSpeakerForClient_(speaker);

  if (showTimestamp && timestamp) {
    label += '  ' + timestamp;
  }

  const table = body.appendTable();
  table.setBorderWidth(0);

  const row = table.appendTableRow();
  const cell = row.appendTableCell();

  // Remove default empty paragraph inside the new table cell.
  if (cell.getNumChildren() > 0) {
    const firstChild = cell.getChild(0);
    if (
      firstChild.getType() === DocumentApp.ElementType.PARAGRAPH &&
      firstChild.asParagraph().getText() === ''
    ) {
      cell.removeChild(firstChild);
    }
  }

  const speakerPara = cell.appendParagraph(label);
  speakerPara.setFontFamily('Arial');
  speakerPara.setFontSize(10);
  speakerPara.setBold(true);
  speakerPara.setForegroundColor('#1f4e79');
  speakerPara.setSpacingBefore(0);
  speakerPara.setSpacingAfter(2);

  const textPara = cell.appendParagraph(text);
  textPara.setFontFamily('Arial');
  textPara.setFontSize(11);
  textPara.setBold(false);
  textPara.setForegroundColor('#222222');
  textPara.setLineSpacing(1.15);
  textPara.setSpacingBefore(0);
  textPara.setSpacingAfter(6);
  textPara.setIndentStart(12);

  const spacer = body.appendParagraph('');
  spacer.setSpacingAfter(2);
  spacer.setSpacingBefore(0);
  spacer.setFontSize(1);
}

function appendImportLog_(body, files) {
  body.appendPageBreak();

  const heading = body.appendParagraph('Import Log');
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  heading.setFontFamily('Arial');

  files.forEach(function(file) {
    const report = preflightTranscriptFiles([file])[0];

    const p = body.appendParagraph(file.name);
    p.setFontFamily('Arial');
    p.setFontSize(11);
    p.setBold(true);

    const details = body.appendParagraph(
      'Status: ' + report.status + '\n' +
      'Lines: ' + report.stats.lines + '\n' +
      'Speaker turns: ' + report.stats.speakerTurns + '\n' +
      'Timestamps: ' + report.stats.timestamps + '\n' +
      'Warnings: ' + (report.warnings.length ? report.warnings.join('; ') : 'None')
    );

    details.setFontFamily('Arial');
    details.setFontSize(9);
    details.setForegroundColor('#666666');
    details.setSpacingAfter(10);
  });
}

function normalizeText_(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\uFEFF/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\u00A0/g, ' ');
}

function isMetadataLine_(line) {
  return /^Project:\s*\[.*?\]\s*$/i.test(line) ||
         /^Clip Name:\s*\[.*?\]\s*$/i.test(line);
}

function isTimestamp_(line) {
  line = String(line || '').trim();

  // Timecode range:
  // 10:54:43:23 - 10:54:48:01
  if (/^\d{1,2}:\d{2}:\d{2}:\d{2}\s*-\s*\d{1,2}:\d{2}:\d{2}:\d{2}$/.test(line)) {
    return true;
  }

  // Avid-style timecode:
  // 10:54:43:23
  if (/^\d{1,2}:\d{2}:\d{2}:\d{2}$/.test(line)) {
    return true;
  }

  // Simple timestamps:
  // 00:20
  // 01:02:03
  if (/^(\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?$/.test(line)) {
    return true;
  }

  return false;
}

function isInlineSpeakerLine_(line) {
  if (isMetadataLine_(line) || isSpeakerLine_(line)) return false;
  const match = String(line || '').trim().match(/^(.{1,80}?):\s+(.+)$/);
  return !!(match && looksLikeSpeakerLabel_(match[1]));
}

function isSpeakerLine_(line) {
  if (!/:$/.test(line)) return false;
  const label = line.replace(/:$/, '').trim();
  return label.split(/:\s*&\s*/).every(looksLikeSpeakerLabel_);
}

function looksLikeSpeakerLabel_(label) {
  label = String(label || '').trim();

  if (!label) return false;
  if (label.length > 80) return false;

  if (/^SPEAKER\s+\d+$/i.test(label)) return true;

  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'&()#/!\-]*$/u.test(label)) {
    return false;
  }

  const words = label.split(/\s+/);

  // Prevent normal sentence fragments from becoming speaker labels.
  if (words.length > 6) return false;

  const uppercaseish = label === label.toUpperCase();

  const titleish = words.every(function(word) {
    return /^[\p{Lu}\p{N}]/u.test(word) || /^(of|the|and|in|on|for)$/i.test(word);
  });

  return uppercaseish || titleish;
}

function cleanSpeaker_(speaker) {
  return String(speaker || '')
    .replace(/:\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpeakerForClient_(speaker) {
  const clean = cleanSpeaker_(speaker);

  if (/^SPEAKER\s+\d+$/i.test(clean)) {
    return clean.toUpperCase();
  }

  return clean
    .toLowerCase()
    .split(' ')
    .map(function(part) {
      if (!part) return part;
      if (/^(ii|iii|iv|dj|mc)$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * Merge only true continuation blocks.
 * Do NOT merge when either block has a timestamp/timecode range,
 * otherwise separate timed captions from the same speaker get collapsed.
 */
function mergeSameSpeakerBlocks_(blocks) {
  const merged = [];

  blocks.forEach(function(block) {
    const prev = merged[merged.length - 1];

    if (
      prev &&
      prev.speaker === block.speaker &&
      !prev.timestamp &&
      !block.timestamp
    ) {
      prev.text += ' ' + block.text;
    } else {
      merged.push(block);
    }
  });

  return merged;
}

function lightCleanClientText_(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function balancedCleanClientText_(text) {
  let out = String(text || '');

  // Remove common transcript performance markers.
  out = out.replace(/<\s*(laugh|laughter|inaudible|crosstalk|music|applause|silence)\s*>/gi, ' ');

  // Normalize ellipses, but keep the feeling of pauses.
  out = out.replace(/\.\.\./g, '…');

  // Remove only the most disposable filler words.
  out = out.replace(/\b(um|uh|erm)\b[,.]?\s*/gi, '');

  // Clean spacing.
  out = out.replace(/\s+([,.?!:;])/g, '$1');
  out = out.replace(/([,.?!:;])([^\s"'])/g, '$1 $2');
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

function aggressiveCleanClientText_(text) {
  let out = balancedCleanClientText_(text);

  // Conservative stutter cleanup only. Avoid removing "very, very" or "no, no."
  out = out.replace(/\b(I|I’m|I'm|you|we|they|he|she|it),\s+\1\b/gi, '$1');

  // Clean repeated clipped fragments like "a- a-" or "vi- vi-".
  out = out.replace(/\b([A-Za-z]{1,4})-\s+\1-\s*/gi, '');

  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

function cleanTitle_(title) {
  return String(title || 'Transcript')
    .replace(/_/g, ' ')
    .replace(/\.Grp\.\d+$/i, '')
    .replace(/\.txt$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
