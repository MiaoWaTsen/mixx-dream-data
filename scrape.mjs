// Scrapes NMIXX's real tour dates and music show wins from Wikipedia into realdata.json, which the game
// fetches from the public MiaoWaTsen/mixx-dream-data repo (src/modules/realDataModule.js).
// Runs there twice a day from a GitHub Actions schedule (.github/workflows/realdata.yml); this file is the
// source and gets copied into that repo as scrape.mjs. Run locally: node scripts/realdata-scrape.mjs [out.json]
//   Tours: en.wikipedia "Nmixx" → every table under "Concerts and tours" (Date | City | Country | Venue …)
//   Wins:  ko.wikipedia "NMIXX" → section "가요 프로그램" (year rows, '''song''', ** [[M월 D일]] … 《[[show]]》)
// realdata-overrides.json next to the output (optional) can fix what Wikipedia gets wrong or lacks:
//   { "addTours": [{ date, city, country, venue }], "removeTours": ["2026-03-17"], "addWins": [{ date, song, show }], "removeWins": [] }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = process.argv[2] || 'realdata.json';
const UA = 'MIXX-DREAM-data/1.0 (https://github.com/MiaoWaTsen/mixx-dream-data)';

async function api(host, params) {
    const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', redirects: '1', ...params });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${host} ${res.status}`);
    return res.json();
}
async function sections(host, page) {
    return (await api(host, { action: 'parse', page, prop: 'sections' })).parse.sections;
}
async function wikitext(host, page, section) {
    return (await api(host, { action: 'parse', page, prop: 'wikitext', section })).parse.wikitext;
}

/** [[Target|Label]] → Label, [[Target]] → Target; drops refs, templates and markup */
function plain(s) {
    return s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '')
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/'''?/g, '').replace(/<[^>]+>/g, '').trim();
}
const cellValue = c => plain(c.replace(/^\s*(?:[a-z-]+="[^"]*"\s*)+\|(?!\|)/i, ''));
const rowspanOf = c => +(c.match(/rowspan="?(\d+)/i)?.[1] || 1);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function isoDate(text) {
    const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!m || !MONTHS.includes(m[1])) return null;
    return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Rows of a wikitable, with rowspans filled in: [[cell, cell, …], …] (header row skipped) */
function tableRows(table) {
    const rows = table.split(/\n\|-/).slice(1);
    const carry = []; // per column: { value, left }
    const out = [];
    for (const row of rows) {
        const cells = [];
        row.split('\n').forEach(line => {
            if (/^\s*[!|]/.test(line) && !/^\s*\|[}+]/.test(line)) {
                line.replace(/^\s*[!|]/, '').split(/\|\||!!/).forEach(c => cells.push(c));
            }
        });
        if (!cells.length) continue;
        const full = [];
        let i = 0;
        for (let col = 0; i < cells.length || carry[col]?.left > 0; col++) {
            if (carry[col]?.left > 0) { full.push(carry[col].value); carry[col].left--; continue; }
            const c = cells[i++];
            const value = cellValue(c);
            const span = rowspanOf(c);
            const cols = +(c.match(/colspan="?(\d+)/i)?.[1] || 1); // e.g. Singapore: one cell for City + Country
            for (let k = 0; k < cols; k++) {
                if (span > 1) carry[col + k] = { value, left: span - 1 };
                full.push(value);
            }
            col += cols - 1;
        }
        out.push(full);
    }
    return out;
}

async function scrapeTours() {
    const secs = await sections('en.wikipedia.org', 'Nmixx');
    const parent = secs.find(s => /concerts and tours/i.test(s.line));
    if (!parent) throw new Error('no "Concerts and tours" section');
    const text = await wikitext('en.wikipedia.org', 'Nmixx', parent.index);
    const tours = [];
    // Each sub-heading is one tour (or fan concert) with its own table
    text.split(/\n(?=={4}[^=])/).forEach(part => {
        const name = plain(part.match(/^====\s*(.+?)\s*====/)?.[1] || '');
        const table = part.match(/\{\|[\s\S]*?\n\|\}/)?.[0];
        if (!name || !table) return;
        const head = table.split(/\n\|-/)[0];
        const cols = [...head.matchAll(/!\s*(?:[^|\n]*\|)?\s*([^\n!|]+)/g)].map(m => plain(m[1]).toLowerCase());
        const at = key => cols.findIndex(c => c.startsWith(key));
        const [d, ci, co, v] = [at('date'), at('city'), at('country'), at('venue')];
        if (d < 0 || ci < 0) return;
        tableRows(table).forEach(r => {
            const date = isoDate(r[d] || '');
            if (date && r[ci]) tours.push({ tour: name, date, city: r[ci], country: co >= 0 ? r[co] : '', venue: v >= 0 ? r[v] : '' });
        });
    });
    return tours;
}

const SHOWS = { '쇼 챔피언': 'Show Champion', '엠카운트다운': 'M Countdown', 'M Countdown': 'M Countdown', '뮤직뱅크': 'Music Bank', '쇼! 음악중심': '音樂中心', '인기가요': '人氣歌謠', '더 쇼': 'The Show' };

async function scrapeWins() {
    const secs = await sections('ko.wikipedia.org', 'NMIXX');
    const sec = secs.find(s => s.line.includes('가요 프로그램'));
    if (!sec) throw new Error('no 가요 프로그램 section');
    const text = await wikitext('ko.wikipedia.org', 'NMIXX', sec.index);
    const wins = [];
    let year = null, song = '';
    text.split('\n').forEach(line => {
        const y = line.match(/^!\s*(\d{4})년/);
        if (y) { year = y[1]; return; }
        const s = line.match(/^\*\s*'''(.+?)'''/);
        if (s) { song = plain(s[1]); return; }
        const w = line.match(/^\*\*\s*\[\[(\d{1,2})월 (\d{1,2})일\]\].*?《\[\[(?:[^\]|]*\|)?([^\]]+)\]\]》/);
        if (w && year) {
            const show = SHOWS[w[3]] || SHOWS[plain(w[3])] || plain(w[3]);
            wins.push({ date: `${year}-${w[1].padStart(2, '0')}-${w[2].padStart(2, '0')}`, song, show });
        }
    });
    return wins;
}

function applyOverrides(data, file) {
    if (!existsSync(file)) return data;
    const o = JSON.parse(readFileSync(file, 'utf8'));
    const tours = data.tours.filter(t => !(o.removeTours || []).includes(t.date)).concat(o.addTours || []);
    const wins = data.wins.filter(w => !(o.removeWins || []).includes(`${w.date}:${w.show}`)).concat(o.addWins || []);
    return { ...data, tours, wins };
}

const byDate = (a, b) => a.date.localeCompare(b.date);
// Keep the last good data for a part that fails to scrape, so a Wikipedia edit can't wipe it
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { tours: [], wins: [] };
const [tours, wins] = await Promise.all([
    scrapeTours().catch(e => { console.error('tours:', e.message); return prev.tours; }),
    scrapeWins().catch(e => { console.error('wins:', e.message); return prev.wins; })
]);
let data = applyOverrides({ tours, wins }, join(dirname(OUT), 'realdata-overrides.json'));
data = { tours: data.tours.sort(byDate), wins: data.wins.sort(byDate) };

const same = JSON.stringify({ tours: prev.tours, wins: prev.wins }) === JSON.stringify(data);
if (same) {
    console.log(`unchanged (${data.tours.length} tour dates, ${data.wins.length} wins)`);
} else {
    writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), ...data }, null, 1) + '\n');
    console.log(`wrote ${OUT}: ${data.tours.length} tour dates, ${data.wins.length} wins`);
}
