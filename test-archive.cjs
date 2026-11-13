// Run with node --test test-archive.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { runInNewContext } = require('node:vm');

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const importer = script.slice(0, script.indexOf('const $='));
const { loadFacebook, looseEntry, buildThreads } = runInNewContext(importer + '\n({ loadFacebook, looseEntry, buildThreads })', {
  Blob, TextDecoder, TextEncoder, URL, setTimeout,
});

const misread = text => Buffer.from(text, 'utf8').toString('latin1');
const shared = { label: '已分享', value: '否' };
const photo = { label: '影音內容', media: [{ uri: 'posts/media/photo.jpg' }] };
const placeholder = {
  timestamp: 1794450829,
  media: [],
  label_values: [
    { label: misread('已分享'), value: misread('否') },
    { label: misread('更新時間'), timestamp_value: 1794450829 },
    { label: misread('影音內容'), media: [] },
  ],
  fbid: '100',
};

test('ignore only empty, unshared records when indexing Facebook JSON', async () => {
  const rows = [
    placeholder,
    { label_values: [shared] },
    { timestamp: 1, data: [{ post: '否' }], label_values: [shared] },
    { label_values: [shared, { label: '文字', value: '否' }] },
    { label_values: [shared, photo] },
    { label_values: [{ ...shared, value: '是' }] },
    { label_values: [shared, { label: '連結', value: 'https://example.com/' }] },
    { ...placeholder, attachments: [{ data: [{ media: { uri: 'missing.jpg' } }] }] },
    { ...placeholder, title: '有標題的貼文' },
    { ...placeholder, custom_field: '需要核對的資料' },
  ];
  const entry = looseEntry(new Blob([JSON.stringify(rows)]), 'posts/activity.json', 0);
  const { data } = await loadFacebook([entry], ['fixture.zip'], [], () => {});
  assert.deepEqual(Array.from(data.items, row => row.locator), rows.slice(2).map((_, i) => '$[' + (i + 2) + ']'));
  assert.equal(data.sources[0].count, rows.length - 2);
  assert.deepEqual(JSON.parse(JSON.stringify(data.sources[0].note)), { t: '{n} 筆欄位格式待核對，可搜尋、展開原始資料', v: { n: 7 } });
  assert.equal(data.items[0].body[0], '否');
});

test('import activity separately from share statistics and attach only unambiguous interactions', async () => {
  const url = 'https://www.facebook.com/101/posts/202/';
  const stats = { timestamp: 10, media: [], fbid: '999', label_values: [
    { label: 'ä½ ' + misread('分享的連結是否仍在等待第一位瀏覽者'), value: misread('正確') },
    { label: misread('你分享的群組連結是否仍在等待第一位瀏覽者'), value: misread('正確') },
    { label: misread('你的資訊用於個人化 Facebook 註冊畫面的次數'), value: '0' },
    { label: misread('你的資訊用於個人化 Facebook 登入橫幅的次數'), value: '0' },
    { label: misread('網址'), value: url, href: url },
  ] };
  const entry = (name, rows) => looseEntry(new Blob([JSON.stringify(rows)]), name, 0);
  const sources = [
    entry('comments/comments.json', { comments_v2: [
      { timestamp: 50, data: [{ comment: { comment: misread('真的嗎？😊'), author: misread('阿晴'), post_id: '202' } }] },
      { timestamp: 51, title: '另一筆留言', data: [{ comment: { comment: '沒有貼文編號' } }] },
    ] }),
    entry('likes_and_reactions/posts_and_comments.json', { reactions_v2: [
      { timestamp: 53, data: [{ reaction: { reaction: 'LOVE', actor: 'Mei', target_url: url } }] },
    ] }),
    entry('posts/your_posts_1.json', [
      stats, { ...stats, data: [{ post: '正確' }] }, { post: '0' },
      { fbid: '202', timestamp: 2, data: [{ post: '正文' }],
        comments: [{ message: '好看', from: { name: 'Chris' } }],
        reactions: { data: [{ name: 'Sam', type: 'CARE' }], summary: { total_count: 7 } } },
      { ...stats, extra: '仍須核對' },
    ]),
    entry('messages/inbox/sample/comments.json', [{ comment: 'private' }]),
  ];
  const { data } = await loadFacebook(sources, ['fixture.zip'], [], () => {});
  assert.equal(data.sources.length, 3);
  assert.equal(data.sources[2].count, 6); // Four retained top-level records and two nested interactions.
  assert.equal(data.items.some(r => r.raw?.fbid === '999' && !r.raw.data && !r.raw.extra), false);
  assert.ok(data.items.some(r => r.body.includes('0')));
  assert.ok(data.items.some(r => r.body.includes('正確')));
  const post = data.items.find(r => r.raw?.fbid === '202');
  assert.deepEqual([...post.body], ['正文']);
  const { threadFor, parents } = buildThreads(data);
  const thread = threadFor.get(post);
  assert.deepEqual(Array.from(thread.comments, r=>r.body[0]).sort(), ['好看', '真的嗎？😊']);
  assert.deepEqual(Array.from(thread.reactions, r=>r.activity.actor).sort(), ['Mei', 'Sam']);
  assert.equal(thread.total, 7);
  assert.equal(parents.has(data.items.find(r=>r.title === '另一筆留言')), false);
});

test('name every reaction with its emoji and show the two copies Meta writes as one', async () => {
  const url = 'https://www.facebook.com/someone/posts/pfbid0abc';
  const entry = (name, rows) => looseEntry(new Blob([JSON.stringify(rows)]), name, 0);
  const sources = [
    entry('comments_and_reactions/likes_and_reactions.json', [
      { timestamp: 9, media: [], fbid: '1', label_values: [
        { label: misread('心情'), value: misread('哈') }, { label: misread('網址'), value: url, href: url },
        { label: misread('名稱'), value: misread('米箱') }] },
    ]),
    entry('comments_and_reactions/likes_and_reactions_1.json', [
      { timestamp: 9, title: misread('我對米箱的貼文傳達了心情。'), data: [{ reaction: { reaction: 'HAHA', actor: 'Me' } }] },
      { timestamp: 11, title: 'angry', data: [{ reaction: { reaction: 'ANGER', actor: 'Me' } }] },
    ]),
  ];
  const { data } = await loadFacebook(sources, ['fixture.zip'], [], () => {});
  assert.deepEqual(Array.from(data.items, r => r.activity.type), ['😆 哈哈', '😆 哈哈', '😡 怒']);
  const { merged, hidden } = buildThreads(data);
  const [linked, titled] = data.items;
  assert.equal(merged.get(titled), linked);
  assert.deepEqual([...hidden], [linked]);
});

const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'chromium');

test('every translation key used by the page has an English entry', () => {
  const en = runInNewContext('(' + script.match(/^const en=(\{[\s\S]*?\n\});$/m)[1] + ')');
  const at = html.indexOf('<body>');
  const keys = new Set();
  for (const m of html.slice(at).matchAll(/<[a-z0-9]+[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)</g)) keys.add(m[1].trim());
  for (const m of html.matchAll(/<[a-z]+[^<>]*data-i18n-attr="([^"]+)"[^<>]*>/g)) {
    for (const name of m[1].split(' ')) keys.add(m[0].match(new RegExp(' ' + name + '="([^"]*)"'))[1]);
  }
  // Literal keys in the script: t('…'), {t:'…'}, thrown errors, and the tables whose values are shown through t().
  for (const m of script.matchAll(/(?:\bt\(|\{t:|Error\(|Note = |\['[A-Z]+',)'([^']*\p{Script=Han}[^']*)'/gu)) keys.add(m[1]);
  for (const table of ['kindNames', 'problems']) {
    for (const m of script.match(new RegExp('const ' + table + '=\\{(.*)\\};'))[1].matchAll(/:'([^']+)'/g)) keys.add(m[1]);
  }
  const missing = [...keys].filter(k => k && !Object.hasOwn(en, k));
  assert.deepEqual(missing, []);
  assert.ok(keys.size > 150, 'found ' + keys.size + ' keys');
});

test('an English browser sees the profile page in English', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-english-'));
  try {
    const items = [{ kind: 'post', title: 'Me shared a post.', ts: 1, body: ['Hello'], links: [], raw: {}, attachments: [] }];
    const data = { format: 'fb-posts-local/1', items, assets: [], inputs: ['export.zip'], sources: [], otherJSON: [],
      issues: [{ t: '{path}：{msg}', v: { path: 'a.json', msg: { t: '檔案資料不完整' } } }] };
    function findChinese() {
      document.getElementById('report').click();
      document.getElementById('lang').remove();
      const seen = document.body.innerText.match(/\p{Script=Han}+/gu);
      document.body.dataset.chinese = document.documentElement.lang + ':' + (seen ? seen.join(' ') : 'none');
    }
    const probe = '<script>(' + findChinese.toString() + ')();</script>';
    const payload = '<script type="application/json" id="archive-data">';
    const fixture = join(dir, 'index.html');
    writeFileSync(fixture, html.replace(payload + 'null', payload + JSON.stringify(data)).replace('</body>', probe + '</body>'));
    const run = spawnSync(chrome, [
      '--headless', '--no-sandbox', '--disable-crashpad-for-testing', '--disable-background-networking',
      '--disable-extensions', '--disable-gpu', '--no-first-run', '--lang=en-US', '--user-data-dir=' + join(dir, 'chrome'),
      '--window-size=1280,900', '--dump-dom', pathToFileURL(fixture).href,
    ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (run.error) throw run.error;
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout.match(/<body\b[^>]*>/)?.[0] || '', /data-chinese="en:none"/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('photos fill the post and three-photo previews use a large lead image', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-photos-'));
  try {
    const titles = ['Single', 'Three'];
    const items = titles.map((title, index) => ({
      kind: 'post', title, ts: 2 - index, body: [], links: [], raw: {},
      attachments: Array.from({ length: index ? 3 : 1 }, (_, i) => ({ asset: i, label: title })),
    }));
    const assets = [1, 2, 3].map(i => ({ kind: 'image', file: 'media/' + i + '.png', path: i + '.png' }));
    const data = { format: 'fb-posts-local/1', items, assets, inputs: [], sources: [], issues: [], otherJSON: [] };
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xoAAAAASUVORK5CYII=', 'base64');
    mkdirSync(join(dir, 'media'));
    for (const asset of assets) writeFileSync(join(dir, asset.file), png);
    const payload = '<script type="application/json" id="archive-data">';
    function checkLayout() {
      const [single, three] = document.querySelectorAll('.post');
      const rect = n => n.getBoundingClientRect();
      const one = rect(single.querySelector('.thumb'));
      const [lead, top, bottom] = [...three.querySelectorAll('.tile')].map(rect);
      const wide = one.width >= rect(single).width - 3;
      const mosaic = lead.height > top.height * 1.9 && top.left === bottom.left && bottom.top > top.top;
      document.body.dataset.galleryCheck = wide && mosaic ? 'pass' : 'fail';
    }
    const probe = '<script>(' + checkLayout.toString() + ')();</script>';
    const fixture = join(dir, 'index.html');
    writeFileSync(fixture, html.replace(payload + 'null', payload + JSON.stringify(data)).replace('</body>', probe + '</body>'));
    for (const width of [390, 1440]) {
      const run = spawnSync(chrome, [
        '--headless', '--no-sandbox', '--disable-crashpad-for-testing', '--disable-background-networking',
        '--disable-extensions', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(dir, 'chrome'),
        '--window-size=' + width + ',900', '--dump-dom', pathToFileURL(fixture).href,
      ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
      if (run.error) throw run.error;
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout.match(/<body\b[^>]*>/)?.[0] || '', /data-gallery-check="pass"/, 'gallery at ' + width + 'px');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('read the profile name, intro and friends for the profile header', async () => {
  const entry = (name, value) => looseEntry(new Blob([JSON.stringify(value)]), name, 0);
  const sources = [
    entry('personal_information/profile_information/profile_information.json', { profile_v2: {
      name: { full_name: misread('傅機長') }, intro_bio: { name: misread('永不屈服') },
      current_city: { name: misread('台中市') }, birthday: { year: 1990 },
      work_experiences: [{ employer: misread('魷魚正'), title: misread('神經病') }],
    } }),
    entry('connections/friends/your_friends.json', { friends_v2: [
      { name: misread('小明'), timestamp: 1700000000 }, { name: 42 },
    ] }),
  ];
  const { data } = await loadFacebook(sources, ['fixture.zip'], [], () => {});
  assert.deepEqual(JSON.parse(JSON.stringify(data.profile)), {
    name: '傅機長', bio: '永不屈服', city: '台中市', work: { employer: '魷魚正', title: '神經病' },
    friends: [{ name: '小明', ts: 1700000000 }],
  });
});
