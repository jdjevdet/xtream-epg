const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CREDENTIALS ---
const XTREAM_URL      = process.env.XTREAM_URL || '';
const XTREAM_USER     = process.env.XTREAM_USER || '';
const XTREAM_PASS     = process.env.XTREAM_PASS || '';
const RENDER_EPG_URL  = process.env.RENDER_EPG_URL || 'https://sports-epg-live.onrender.com/upload';
const AUTH_TOKEN      = process.env.AUTH_TOKEN || 'MaryJane1905!';

app.use(express.json());

// --- EXTRACT CHANNEL NUMBER FROM PREFIX ---
function extractChannelNumber(channelName) {
  const pipeIdx = channelName.indexOf('|');
  const prefix = pipeIdx >= 0 ? channelName.substring(0, pipeIdx) : channelName;

  const numMatch = prefix.match(/(\d{2,3})/);
  if (!numMatch) return null;

  const num = numMatch[1];
  const n = prefix.toUpperCase();

  if (n.includes('BTN+') || n.includes('BTN +'))                return `BTN+ ${num}`;
  if (n.includes('CBC'))                                          return `CBC ${num}`;
  if (n.includes('CHL'))                                          return `CHL ${num}`;
  if (n.includes('DAZN') && n.includes('CA'))                    return `DAZN CA ${num}`;
  if (n.includes('DAZN') && n.includes('UK'))                    return `DAZN UK ${num}`;
  if (n.includes('DAZN'))                                         return `DAZN ${num}`;
  if (n.includes('ESPN PLUS'))                                    return `ESPN PLUS ${num}`;
  if (n.includes('ESPN+') || n.includes('ESPN +'))               return `ESPN+ ${num}`;
  if (n.includes('APPLE_F1') || n.includes('APPLE F1'))          return `Apple F1 ${num}`;
  if (n.includes('FLSP') || n.includes('FLOSPORTS'))             return `FLSP ${num}`;
  if (n.includes('MAX USA'))                                      return `MAX USA ${num}`;
  if (n.includes('NCAAB'))                                        return `NCAAB ${num}`;
  if (n.includes('PARAMOUNT+') || n.includes('PARAMOUNT +'))     return `Paramount+ ${num}`;
  if (n.includes('PEACOCK'))                                      return `Peacock ${num}`;
  if (n.includes('SEC+') && n.includes('ACCNX'))                 return `SEC+ ACCNX ${num}`;
  if (n.includes('SEC+'))                                         return `SEC+ ${num}`;
  if (n.includes('SPORTSNET+') || n.includes('SPORTSNET +'))     return `Sportsnet+ ${num}`;
  if (n.includes('STAN'))                                         return `STAN ${num}`;
  if (n.includes('TSN+') || n.includes('TSN +'))                 return `TSN+ ${num}`;
  if (n.includes('VICTORY+') || n.includes('VICTORY +'))         return `Victory+ ${num}`;

  return null;
}

// --- PLATFORM DETECTION ---
function detectPlatform(channelName) {
  const n = channelName.toUpperCase();
  if (n.includes('BTN+') || n.includes('BTN +'))                return 'Big Ten+';
  if (n.includes('CBC'))                                          return 'CBC';
  if (n.includes('CHL'))                                          return 'CHL';
  if (n.includes('DAZN') && n.includes('CA'))                    return 'DAZN CA';
  if (n.includes('DAZN') && n.includes('UK'))                    return 'DAZN UK';
  if (n.includes('DAZN'))                                         return 'DAZN';
  if (n.includes('ESPN PLUS') || n.includes('ESPN+'))            return 'ESPN+';
  if (n.includes('APPLE_F1') || n.includes('APPLE F1'))          return 'F1 (Apple TV+)';
  if (n.includes('FLSP') || n.includes('FLOSPORTS'))             return 'FloSports';
  if (n.includes('MAX USA') || n.includes('HBO MAX'))            return 'HBO Max';
  if (n.includes('NCAAB'))                                        return 'NCAAB';
  if (n.includes('PARAMOUNT+') || n.includes('PARAMOUNT +'))     return 'Paramount+';
  if (n.includes('PEACOCK'))                                      return 'Peacock';
  if (n.includes('SEC+') || n.includes('ACCNX'))                 return 'SEC+/ACC Extra';
  if (n.includes('SPORTSNET+') || n.includes('SPORTSNET +'))     return 'Sportsnet+';
  if (n.includes('STAN'))                                         return 'Stan';
  if (n.includes('TENNIS'))                                       return 'Tennis';
  if (n.includes('TSN+') || n.includes('TSN +'))                 return 'TSN+';
  if (n.includes('VICTORY+') || n.includes('VICTORY +'))         return 'Victory+';
  return null;
}

// --- EXTRACT TITLE AND TIME FROM CHANNEL NAME ---
function parseChannelName(channelName) {
  let title = '';
  let timeInfo = null;

  // Format 1: "PREFIX | Title (ISO datetime)"
  const pipeISOMatch = channelName.match(/\|\s*(.+?)\s*\((\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(?::\d{2})?)\)/);
  if (pipeISOMatch) {
    title = pipeISOMatch[1].trim();
    timeInfo = { type: 'iso', value: pipeISOMatch[2] };
    return { title, timeInfo };
  }

  // Format 2: "PREFIX: Title (3.25 7:00 PM ET)"
  const dotDateMatch = channelName.match(/[:|]\s*(.+?)\s*\((\d{1,2}\.\d{2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:ET|EST|EDT|PT|PST|PDT|CT|CST|CDT)?)\)/i);
  if (dotDateMatch) {
    title = dotDateMatch[1].trim();
    timeInfo = { type: 'dotdate', date: dotDateMatch[2], time: dotDateMatch[3].trim() };
    return { title, timeInfo };
  }

  // Format 3: "PREFIX: Title (03.25 2AM ET/11PM PT)"
  const espnPlusMatch = channelName.match(/[:|]\s*(.+?)\s*\((\d{2}\.\d{2})\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*(?:ET|EST|EDT)?)/i);
  if (espnPlusMatch) {
    title = espnPlusMatch[1].trim();
    timeInfo = { type: 'dotdate', date: espnPlusMatch[2], time: espnPlusMatch[3].trim() };
    return { title, timeInfo };
  }

  // Format 4: "PREFIX: Title @ Mon DD HH:MM AM/PM TZ"
  const atMonDayMatch = channelName.match(/[:|]\s*(.+?)\s*@\s*(\w{3}\s+\d{1,2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT)?)/i);
  if (atMonDayMatch) {
    title = atMonDayMatch[1].trim();
    timeInfo = { type: 'monthday', date: atMonDayMatch[2].trim(), time: atMonDayMatch[3].trim() };
    return { title, timeInfo };
  }

  // Format 5: "PREFIX: Title @ DD Mon HH:MM AM/PM TZ"
  const atDayMonMatch = channelName.match(/[:|]\s*(.+?)\s*@\s*(\d{1,2}\s+\w{3})\s+(\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT)?)/i);
  if (atDayMonMatch) {
    title = atDayMonMatch[1].trim();
    timeInfo = { type: 'daymonth', date: atDayMonMatch[2].trim(), time: atDayMonMatch[3].trim() };
    return { title, timeInfo };
  }

  // Format 6: "PREFIX: Title (03.25 HH:MM AM/PM TZ)"
  const secMatch = channelName.match(/[:|]\s*(.+?)\s*\((\d{2}\.\d{2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:ET|EST|EDT|PT|PST|PDT)?)\)/i);
  if (secMatch) {
    title = secMatch[1].trim();
    timeInfo = { type: 'dotdate', date: secMatch[2], time: secMatch[3].trim() };
    return { title, timeInfo };
  }

  return null;
}

// --- CONVERT TIME INFO TO UTC DATE ---
function timeInfoToUTC(timeInfo, currentYear) {
  try {
    let dt;

    if (timeInfo.type === 'iso') {
      const isoStr = timeInfo.value.replace(' ', 'T');
      dt = new Date(`${isoStr}Z`);
      dt.setUTCHours(dt.getUTCHours() + 5);

    } else if (timeInfo.type === 'dotdate') {
      const parts = timeInfo.date.split('.');
      const month = parseInt(parts[0]) - 1;
      const day   = parseInt(parts[1]);
      const [hours, minutes] = normalizeTime(timeInfo.time);
      dt = new Date(Date.UTC(currentYear, month, day, hours, minutes, 0));
      dt = applyTimezoneOffset(dt, timeInfo.time);

    } else if (timeInfo.type === 'monthday') {
      const cleanTime = timeInfo.time.replace(/\s*(ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT)\s*/i, '').trim();
      dt = new Date(`${timeInfo.date} ${currentYear} ${cleanTime}`);
      if (isNaN(dt)) return null;
      dt = applyTimezoneOffset(dt, timeInfo.time);

    } else if (timeInfo.type === 'daymonth') {
      const parts = timeInfo.date.split(' ');
      const cleanTime = timeInfo.time.replace(/\s*(ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT)\s*/i, '').trim();
      dt = new Date(`${parts[1]} ${parts[0]} ${currentYear} ${cleanTime}`);
      if (isNaN(dt)) return null;
      dt = applyTimezoneOffset(dt, timeInfo.time);
    }

    if (!dt || isNaN(dt)) return null;
    return dt;

  } catch (err) {
    return null;
  }
}

function normalizeTime(timeStr) {
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return [0, 0];
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] || '0');
  const period = match[3].toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return [hours, minutes];
}

function applyTimezoneOffset(dt, timeStr) {
  const isPT = /PT|PST|PDT/i.test(timeStr);
  const isCT = /CT|CST|CDT/i.test(timeStr);
  const isMT = /MT|MST|MDT/i.test(timeStr);
  let offset = 4; // Default EDT (UTC-4)
  if (isPT) offset = 7;
  if (isCT) offset = 5;
  if (isMT) offset = 6;
  dt.setUTCHours(dt.getUTCHours() + offset);
  return dt;
}

// --- SMART DURATION DETECTION ---
function detectDuration(title) {
  const t = title.toLowerCase();
  if (/\bgolf\b/.test(t) || /\bnascar\b/.test(t) || /\bcycling\b/.test(t) || /\bmarathon\b/.test(t) || /\bindycar\b/.test(t) || /\bf1\b|formula 1/.test(t)) return 240;
  if (/\bnfl\b/.test(t) || /\bnba\b/.test(t) || /\bnhl\b/.test(t) || /\bmlb\b/.test(t) || /\bufc\b/.test(t) || /\bmma\b/.test(t) || /\bboxing\b/.test(t) || /\bwwe\b/.test(t) || /\bfight\b/.test(t)) return 180;
  if (/\bvs\.?\b/.test(t) || / @ /.test(t) || /\bfinal\b/.test(t) || /\bplayoff\b/.test(t) || /\bchampionship\b/.test(t) || /\bmatch\b/.test(t) || /\bgame\b/.test(t)) return 120;
  if (/\bhighlights\b/.test(t) || /\brecap\b/.test(t) || /\bnews\b/.test(t)) return 30;
  if (/\bshow\b/.test(t) || /\bdaily\b/.test(t) || /\bpress conference\b/.test(t) || /\bdraft\b/.test(t)) return 60;
  return 60;
}

// --- CALCULATE END TIME AT 6AM EST NEXT DAY ---
function getNextDay6amEST(eventEndDate) {
  const next = new Date(eventEndDate);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(11, 0, 0, 0);
  return next;
}

// --- XMLTV HELPERS ---
function escapeXML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toXMLTVDate(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${dt.getUTCFullYear()}` +
    `${pad(dt.getUTCMonth() + 1)}` +
    `${pad(dt.getUTCDate())}` +
    `${pad(dt.getUTCHours())}` +
    `${pad(dt.getUTCMinutes())}` +
    `${pad(dt.getUTCSeconds())}` +
    ` +0000`
  );
}

// --- FETCH CHANNELS FROM XTREAM API ---
async function fetchXtreamChannels() {
  console.log(`[${new Date().toISOString()}] Fetching channels from Xtream API...`);

  const url = `${XTREAM_URL}/player_api.php?username=${XTREAM_USER}&password=${XTREAM_PASS}&action=get_live_categories`;
  const catResponse = await axios.get(url);
  const categories = catResponse.data;

  const sportsCategories = categories.filter(cat =>
    cat.category_name.toLowerCase().includes('sport')
  );

  console.log(`Found ${sportsCategories.length} sports categories`);

  let allChannels = [];

  for (const cat of sportsCategories) {
    const streamsUrl = `${XTREAM_URL}/player_api.php?username=${XTREAM_USER}&password=${XTREAM_PASS}&action=get_live_streams&category_id=${cat.category_id}`;
    const streamsResponse = await axios.get(streamsUrl);
    const streams = streamsResponse.data;
    allChannels = allChannels.concat(streams.map(s => ({
      name: s.name,
      category: cat.category_name
    })));
  }

  console.log(`Fetched ${allChannels.length} total sports channels`);
  return allChannels;
}

// --- GENERATE EPG XML ---
async function generateAndPushEPG() {
  console.log(`[${new Date().toISOString()}] Starting EPG generation from Xtream API...`);

  const currentYear = new Date().getUTCFullYear();
  const channels = await fetchXtreamChannels();

  let allChannelBlocks = '';
  let allProgrammeBlocks = '';
  let totalEvents = 0;
  let skipped = 0;

  for (const ch of channels) {
    const platform = detectPlatform(ch.name);
    if (!platform) { skipped++; continue; }
    if (platform === 'Tennis') { skipped++; continue; }

    const parsed = parseChannelName(ch.name);
    if (!parsed || !parsed.timeInfo) { skipped++; continue; }

    const { title, timeInfo } = parsed;
    if (!title || title.length < 2) { skipped++; continue; }

    const startDate = timeInfoToUTC(timeInfo, currentYear);
    if (!startDate || isNaN(startDate)) { skipped++; continue; }

    const channelNum = extractChannelNumber(ch.name);
    const displayTitle = channelNum ? `${channelNum} - ${title}` : title;

    const duration  = detectDuration(title);
    const endDate   = new Date(startDate.getTime() + duration * 60 * 1000);
    const preStart  = new Date(startDate.getTime() - 720 * 60 * 1000);
    const postEnd   = getNextDay6amEST(endDate);

    // Use stable prefix (everything before the pipe) as channel ID
    const pipeIdx = ch.name.indexOf('|');
    const stablePrefix = pipeIdx >= 0
      ? ch.name.substring(0, pipeIdx).trim()
      : (channelNum || title);
    const channelId = stablePrefix;

    const titleEsc    = escapeXML(displayTitle);
    const platformEsc = escapeXML(platform);
    const dateStr     = startDate.toISOString().split('T')[0];
    const shortNum    = channelNum ? channelNum.replace(/\s+/g, ' ').trim() : null;

    const preStartXMLTV = toXMLTVDate(preStart);
    const startXMLTV    = toXMLTVDate(startDate);
    const endXMLTV      = toXMLTVDate(endDate);
    const postEndXMLTV  = toXMLTVDate(postEnd);

    // Channel block — stable prefix as ID for consistent auto-matching
    allChannelBlocks += `  <channel id="${escapeXML(stablePrefix)}">\n`;
    allChannelBlocks += `    <display-name lang="en">${escapeXML(stablePrefix)}</display-name>\n`;
    if (shortNum) {
      allChannelBlocks += `    <display-name lang="en">${escapeXML(channelNum)}</display-name>\n`;
    }
    allChannelBlocks += `  </channel>\n`;

    // Block 1: Up Next
    allProgrammeBlocks += `  <programme start="${preStartXMLTV}" stop="${startXMLTV}" channel="${escapeXML(channelId)}">\n`;
    allProgrammeBlocks += `    <title lang="en">Up Next: ${titleEsc}</title>\n`;
    allProgrammeBlocks += `    <desc lang="en">Coming up on ${platformEsc}: ${titleEsc} | ${dateStr}</desc>\n`;
    allProgrammeBlocks += `    <category lang="en">${platformEsc}</category>\n`;
    allProgrammeBlocks += `  </programme>\n\n`;

    // Block 2: The Event
    allProgrammeBlocks += `  <programme start="${startXMLTV}" stop="${endXMLTV}" channel="${escapeXML(channelId)}">\n`;
    allProgrammeBlocks += `    <title lang="en">${titleEsc}</title>\n`;
    allProgrammeBlocks += `    <desc lang="en">${platformEsc} - ${titleEsc} | ${dateStr}</desc>\n`;
    allProgrammeBlocks += `    <category lang="en">${platformEsc}</category>\n`;
    allProgrammeBlocks += `  </programme>\n\n`;

    // Block 3: Ended
    allProgrammeBlocks += `  <programme start="${endXMLTV}" stop="${postEndXMLTV}" channel="${escapeXML(channelId)}">\n`;
    allProgrammeBlocks += `    <title lang="en">${titleEsc} - Ended</title>\n`;
    allProgrammeBlocks += `    <desc lang="en">${platformEsc} - ${titleEsc} has ended. | ${dateStr}</desc>\n`;
    allProgrammeBlocks += `    <category lang="en">${platformEsc}</category>\n`;
    allProgrammeBlocks += `  </programme>\n\n`;

    totalEvents++;
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE tv SYSTEM "xmltv.dtd">\n` +
    `<tv generator-info-name="XtreamEPG">\n\n` +
    allChannelBlocks + `\n` +
    allProgrammeBlocks +
    `</tv>`;

  await axios.post(RENDER_EPG_URL, xml, {
    headers: {
      'Content-Type': 'application/xml',
      'x-auth-token': AUTH_TOKEN
    }
  });

  console.log(`[${new Date().toISOString()}] EPG pushed — ${totalEvents} events generated, ${skipped} skipped.`);
}

// --- DEBUG: Show skipped channels ---
app.get('/debug-skipped', async (req, res) => {
  try {
    const currentYear = new Date().getUTCFullYear();
    const channels = await fetchXtreamChannels();
    const skipped = [];

    for (const ch of channels) {
      const platform = detectPlatform(ch.name);
      if (!platform) {
        skipped.push({ reason: 'no platform', name: ch.name });
        continue;
      }
      if (platform === 'Tennis') continue;

      const parsed = parseChannelName(ch.name);
      if (!parsed || !parsed.timeInfo) {
        skipped.push({ reason: 'no time parsed', platform, name: ch.name });
        continue;
      }

      const startDate = timeInfoToUTC(parsed.timeInfo, currentYear);
      if (!startDate || isNaN(startDate)) {
        skipped.push({ reason: 'invalid date', platform, name: ch.name });
        continue;
      }
    }

    res.json({
      total_skipped: skipped.length,
      samples: skipped.slice(0, 100)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MANUAL TRIGGER ENDPOINTS ---
app.get('/run', async (req, res) => {
  res.json({ message: 'EPG generation started...' });
  try {
    await generateAndPushEPG();
  } catch (err) {
    console.error('Manual run failed:', err.message);
  }
});

app.get('/generate', async (req, res) => {
  try {
    await generateAndPushEPG();
    res.json({ success: true, message: 'EPG generated and pushed successfully!' });
  } catch (err) {
    console.error('Error generating EPG:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Xtream EPG Generator is running. Visit /run or /generate to trigger manually.');
});

// --- SCHEDULE: RUNS EVERY DAY AT 6AM EST (11:00 UTC) ---
cron.schedule('0 11 * * *', () => {
  console.log('Running scheduled EPG generation...');
  generateAndPushEPG().catch(err => console.error('Scheduled run failed:', err.message));
});

// --- START SERVER + RUN IMMEDIATELY ON BOOT ---
app.listen(PORT, () => {
  console.log(`Xtream EPG Generator running on port ${PORT}`);
  generateAndPushEPG().catch(err => console.error('Initial run failed:', err.message));
});