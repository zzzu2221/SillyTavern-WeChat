/* ============================================================================
 * 微信 · WeChat for SillyTavern — SillyTavern 扩展（iframe 注入式）
 *
 * 在酒馆页面里提供一个悬浮「微信」按钮，点击全屏打开仿微信聊天前端，
 * 前端通过 parent.WXBRIDGE 与酒馆对接（角色/会话/聊天/生图/朋友圈）。
 * 通讯录白名单、聊天模型、生图参数、朋友圈自动发布均可在设置面板调整。
 *
 * 全部酒馆能力通过 SillyTavern.getContext() 桥接（角色/CSRF 头/设置/缩略图），
 * 不依赖 ST 内部模块作用域变量，跨版本更稳。
 * ========================================================================== */
import { power_user } from '../../../../power-user.js';
import { tags as ST_TAGS, tag_map as ST_TAG_MAP } from '../../../../tags.js';
(function () {
  'use strict';
  var LOG = '[WeChat-ST]';
  var EXT_KEY = 'wechat-st';
  /** AI 写朋友圈配图生图提示词的硬性规则（源自用户「总结并生图格式」世界书） */
  var IMG_PROMPT_RULES = [
    '1. 只写画面描述英文关键词（纯英文短标签，单行不换行），绝对不要添加画质、画风类词汇（如 masterpiece, best quality, anime style, illustration, highly detailed 等），这些由插件全局预设自动加载。',
    '2. 关键词排序顺序固定：角色英文名称 → 年龄性别 → 发型样貌 → 穿戴细节 → 神态表情 → 身体动作 → 手部细节 → 所处环境 → 光影氛围 → 次要物品 → 画面约束。',
    '3. 角色必须有固定人设锚点：先写该角色在其出处原作/设定中的英文名或罗马音（从角色卡描述中提取，例如五条悟=gojou satoru，其他世界观角色同理），再写标志性外貌（同样从角色卡描述中提取：发型、瞳色、特征服饰、面饰等），服饰神态动作严格贴合当前剧情。',
    '4. 仅还原本轮剧情关键画面，不脑补、不带过往剧情。',
    '5. 多人群像只细化 1~2 个主要角色，配角极简站位。',
    '6. 全程规避畸形肢体、错误构图。',
  ].join('\n');
  // iframe 路径：从本模块地址推导，兼容任意安装目录（用户级/全局、任意文件夹名）
  var APP_PATH = (function () {
    try {
      var u = new URL('../app/index.html', import.meta.url);
      return u.pathname + u.search;
    } catch (e) { return '/scripts/extensions/third-party/SillyTavern-WeChat/app/index.html'; }
  })();
  var MOMENTS_GROUP_NAME = '朋友圈';
  var ARTICLES_GROUP_NAME = '公众号';
  var OVERLAY_ID = 'wxst-overlay';
  var LAUNCHER_ID = 'wxst-launcher';
  var SETTINGS_ID = 'wxst-settings';
  var charCache = null;   // {at:timestamp, list:[...]}

  function ctx() { try { return (window.SillyTavern && SillyTavern.getContext) ? SillyTavern.getContext() : null; } catch (e) { return null; } }
  function log() { try { console.log.apply(console, [LOG].concat(Array.prototype.slice.call(arguments))); } catch (e) {} }
  function toast(msg, kind) { try { if (window.toastr) toastr[kind || 'info'](msg, '微信'); } catch (e) { log(msg); } }

  /* ---------------- 设置 ---------------- */
  function getSettings() {
    var c = ctx();
    if (!c || !c.extensionSettings) return {};
    if (!c.extensionSettings[EXT_KEY]) c.extensionSettings[EXT_KEY] = {};
    return c.extensionSettings[EXT_KEY];
  }
  function saveSettings() { try { var c = ctx(); if (c && c.saveSettingsDebounced) c.saveSettingsDebounced(); } catch (e) {} }

  /* ---------------- CSRF 与 ST REST ---------------- */
  function headers() {
    var h = { 'Content-Type': 'application/json' };
    try { var c = ctx(); if (c && c.getRequestHeaders) Object.assign(h, c.getRequestHeaders()); } catch (e) {}
    return h;
  }

  async function st(method, path, body) {
    var res = await fetch(path, {
      method: method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    var text = await res.text();
    var data; try { data = JSON.parse(text); } catch (e) { data = text; }
    if (!res.ok) {
      var err = new Error(path + ' -> ' + res.status);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------- 角色（文件名头像 → data URL 缓存） ---------------- */
  async function avatarToDataURL(url) {
    try {
      var res = await fetch(url);
      if (!res.ok) return '';
      var blob = await res.blob();
      return await new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result || ''); };
        fr.onerror = function () { resolve(''); };
        fr.readAsDataURL(blob);
      });
    } catch (e) { return ''; }
  }

  async function listCharacters() {
    var now = Date.now();
    if (charCache && now - charCache.at < 60000) return charCache.list;
    var chars = null;
    try { var c = ctx(); if (c && c.getCharacters) chars = await c.getCharacters(); } catch (e) {}
    if (!chars || !chars.length) { try { chars = ctx().characters || []; } catch (e) {} }
    var out = [];
    var tasks = [];
    for (var i = 0; i < (chars || []).length; i++) {
      (function (ch) {
        if (!ch || !ch.name) return;
        var item = {
          name: ch.name,
          displayName: ch.name,
          key: String(ch.avatar || ch.name),   // 角色唯一标识（avatar 文件名），区分同名卡
          avatar: '',
          avatar_file: ch.avatar || '',   // 原始文件名，供 /api/chats/* 用
          description: ch.description || '',
          personality: ch.personality || '',
          scenario: ch.scenario || '',
          greeting: ch.greeting || ch.first_mes || '',
          alternateGreetings: Array.isArray(ch.alternate_greetings) ? ch.alternate_greetings.map(function (x) { return String(x); }) : [],
          tag: (function () {
            // ST 把用户手动打的 tag 存在 settings.json 的 tags(id->name) + tag_map(avatar->tag id)
            var ids = [];
            try {
              var tm = ST_TAG_MAP || {};
              var raw = tm[String(ch.avatar || '')];
              ids = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            } catch (e) {}
            var names = [];
            try {
              var tl = ST_TAGS || [];
              ids.filter(Boolean).forEach(function (id) {
                var t = tl.find(function (x) { return String(x.id) === String(id); });
                names.push(t && t.name ? String(t.name) : String(id));
              });
            } catch (e) {}
            if (!names.length) {
              // 兜底：角色卡内嵌 tags 字段
              var t = Array.isArray(ch.tags) ? ch.tags : (ch.data && Array.isArray(ch.data.tags)) ? ch.data.tags : Array.isArray(ch.tag) ? ch.tag : [];
              names = t.map(String);
            }
            return names;
          })(),
        };
        out.push(item);
        var file = ch.avatar;
        if (file && file !== 'none') {
          var url = file.startsWith('data:') ? file : null;
          if (!url) { try { url = ctx().getThumbnailUrl('avatar', file); } catch (e) {} }
          tasks.push(avatarToDataURL(url).then(function (data) { item.avatar = data; }));
        }
      })(chars[i]);
    }
    await Promise.all(tasks);
    // 同名角色加区分后缀，用于展示（如：角色名、角色名 #2）
    var nameCount = {};
    out.forEach(function (c) { nameCount[c.name] = (nameCount[c.name] || 0) + 1; });
    var seen = {};
    out.forEach(function (c) {
      if (nameCount[c.name] > 1) {
        seen[c.name] = (seen[c.name] || 0) + 1;
        c.displayName = c.name + (seen[c.name] > 1 ? ' #' + seen[c.name] : '');
      } else {
        c.displayName = c.name;
      }
    });
    charCache = { at: now, list: out };
    return out;
  }

  function whitelistOf() {
    var s = getSettings();
    if (!Array.isArray(s.whitelist)) return null; // null = 全部
    return s.whitelist.map(String);
  }
  /** 白名单判定：key 优先，兼容旧版本按 name 存的 whitelist */
  function isAllowed(key, name) {
    var w = whitelistOf();
    if (!w) return true;
    return w.indexOf(String(key)) >= 0 || (name != null && w.indexOf(String(name)) >= 0);
  }

  /* ---------------- 聊天配置 ---------------- */
  function chatConfig() {
    var s = getSettings();
    var oai = null; try { oai = ctx().chatCompletionSettings || null; } catch (e) {}
    var over = s.chat || {};
    return {
      source: over.source || (oai && oai.chat_completion_source) || 'custom',
      custom_url: over.custom_url || (oai && oai.custom_url) || 'https://api.siliconflow.cn/v1',
      model: over.model || (oai && oai.custom_model) || '',
      temperature: over.temperature != null ? over.temperature : 0.9,
      max_tokens: over.max_tokens || 1024,
    };
  }

  async function genChat(messages, opts) {
    opts = opts || {};
    var cfg = chatConfig();
    var body = {
      chat_completion_source: cfg.source,
      custom_url: cfg.custom_url,
      model: cfg.model,
      messages: messages,
      stream: false,
      temperature: opts.temperature != null ? opts.temperature : cfg.temperature,
      max_tokens: opts.max_tokens || cfg.max_tokens,
    };
    var data = await st('POST', '/api/backends/chat-completions/generate', body);
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content) throw new Error('模型未返回内容');
    return { content: content };
  }

  /* ---------------- 生图（自填 NovelAI API / 走酒馆代理 / 智绘机继承） ---------------- */
  function chatu8Settings() {
    try { return ctx().extensionSettings['st-chatu8'] || null; } catch (e) { return null; }
  }
  /** 从智绘机读取「提示词预设」列表：[{name, prompt, neg}] */
  function chatu8Presets() {
    var zh = chatu8Settings();
    if (!zh || !zh.yushe) return [];
    var obj = zh.yushe;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return []; } }
    if (!obj || typeof obj !== 'object') return [];
    var list = [];
    Object.keys(obj).forEach(function (name) {
      var p = obj[name] || {};
      var fp = String(p.fixedPrompt || '').trim();
      var fe = String(p.fixedPrompt_end || '').trim();
      var np = String(p.negativePrompt || '').trim();
      if (!name || (!fp && !np)) return;
      list.push({ name: name, prompt: [fp, fe].filter(Boolean).join(', '), neg: np || undefined });
    });
    return list;
  }
  function chatu8CurrentPresetName() {
    var zh = chatu8Settings();
    return (zh && zh.yusheid_novelai) ? zh.yusheid_novelai : '';
  }
  function chatu8NegativePrompt() {
    var presets = chatu8Presets();
    var cur = chatu8CurrentPresetName();
    var p = presets.find(function (x) { return x.name === cur; });
    if (p && p.neg) return p.neg;
    return '';
  }

  function imageConfig() {
    var s = getSettings();
    var zh = chatu8Settings();
    var im = s.image || {};
    var presets = (Array.isArray(im.presets) && im.presets.length) ? im.presets : chatu8Presets();
    var site = (zh && zh.novelaisite) || '';
    var apiUrlDefault = (site === '其他站点' && zh.novelaiOtherSite) || 'https://image.novelai.net/ai/generate-image';
    return {
      enabled: getSettings().imageEnabled !== false,
      mode: im.mode || 'direct',   // 'direct' 直连 NovelAI API（同智绘机）；'proxy' 走酒馆代理
      apiUrl: im.apiUrl || apiUrlDefault,
      apiKey: im.apiKey || (zh && zh.novelaiApi) || '',
      basePrompt: im.basePrompt || '',
      defaultPreset: im.defaultPreset || chatu8CurrentPresetName(),
      presets: presets,
      scale: im.scale != null ? im.scale : (zh && zh.nai3Scale != null ? Number(zh.nai3Scale) : 10),
      cfg_rescale: im.cfg_rescale != null ? im.cfg_rescale : (zh && zh.cfg_rescale != null ? Number(zh.cfg_rescale) : 0.18),
      model: im.model || (zh && zh.novelaimode) || 'nai-diffusion-4-5-full',
      width: im.width || (zh && zh.novelai_width) || 1216,
      height: im.height || (zh && zh.novelai_height) || 832,
      steps: im.steps || (zh && zh.novelai_steps) || 28,
      sampler: im.sampler || (zh && zh.novelai_sampler) || 'k_euler',
      scheduler: im.scheduler || (zh && zh.Schedule) || 'karras',
      negative_prompt: im.negative_prompt || chatu8NegativePrompt() || 'lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
      sm: im.sm != null ? im.sm : (zh ? (zh.sm != null ? zh.sm : true) : true),
      sm_dyn: im.sm_dyn != null ? im.sm_dyn : (zh ? (zh.dyn != null ? zh.dyn : true) : true),
      decrisper: im.decrisper != null ? im.decrisper : (zh ? (zh.nai3Deceisp != null ? zh.nai3Deceisp : true) : true),
      // 质量标签 AQT：智绘机在提示词末尾追加（默认 = 智绘机 AQT_novelai 配置；缺失时用 NovelAI Heavy 标准）
      aqt: im.aqt != null ? im.aqt : (zh && zh.AQT_novelai ? zh.AQT_novelai : 'best quality, amazing quality, very aesthetic, absurdres'),
    };
  }

  /** 一键把智绘机(st-chatu8)的 NovelAI 配置与预设全部复制到本扩展设置 */
  function importFromChatu8() {
    var zh = chatu8Settings();
    if (!zh) throw new Error('未检测到智绘机(st-chatu8)设置');
    var s = getSettings();
    var presets = chatu8Presets();
    var cur = chatu8CurrentPresetName();
    // 站点：官网 → 直连官方；其他站点 → 自定义地址
    var site = String(zh.novelaisite || '');
    var apiUrl = (site === '其他站点' && zh.novelaiOtherSite)
      ? zh.novelaiOtherSite
      : 'https://image.novelai.net/ai/generate-image';
    var im = {
      mode: 'direct', // 跟随智绘机：浏览器直连，不走酒馆代理
      apiUrl: apiUrl,
      apiKey: zh.novelaiApi || undefined,
      defaultPreset: cur || undefined,
      presets: presets.length ? presets : undefined,
      model: zh.novelaimode || undefined,
      width: zh.novelai_width ? Number(zh.novelai_width) : undefined,
      height: zh.novelai_height ? Number(zh.novelai_height) : undefined,
      steps: zh.novelai_steps ? Number(zh.novelai_steps) : undefined,
      sampler: zh.novelai_sampler || undefined,
      scheduler: zh.Schedule || undefined,
      negative_prompt: chatu8NegativePrompt() || undefined,
      sm: zh.sm != null ? (String(zh.sm) === 'true' || zh.sm === true) : undefined,
      sm_dyn: zh.dyn != null ? (String(zh.dyn) === 'true' || zh.dyn === true) : undefined,
      decrisper: zh.nai3Deceisp != null ? (String(zh.nai3Deceisp) === 'true' || zh.nai3Deceisp === true) : undefined,
      scale: zh.nai3Scale != null ? Number(zh.nai3Scale) : undefined,
      cfg_rescale: zh.cfg_rescale != null ? Number(zh.cfg_rescale) : undefined,
      aqt: zh.AQT_novelai ? zh.AQT_novelai : undefined,
    };
    Object.keys(im).forEach(function (k) { if (im[k] === undefined) delete im[k]; });
    s.image = im;
    saveSettings();
    return { imported: true, mode: im.mode, apiUrl: apiUrl, presets: presets.map(function (p) { return p.name; }), defaultPreset: cur, hasKey: !!zh.novelaiApi, scale: im.scale, cfg_rescale: im.cfg_rescale };
  }

  /** 找到命名的预设（没有则 null） */
  function findPreset(name) {
    var im = imageConfig();
    if (!name || !im.presets.length) return null;
    for (var i = 0; i < im.presets.length; i++) {
      if (im.presets[i] && im.presets[i].name === name) return im.presets[i];
    }
    return null;
  }

  /** 拼接最终正向提示词（对齐智绘机：基础正面 + 预设固定提示词 + 剧情词 + 质量标签 AQT，并做 tag 去重） */
  function composePrompt(prompt, presetName) {
    var im = imageConfig();
    var parts = [];
    if (im.basePrompt && String(im.basePrompt).trim()) parts.push(String(im.basePrompt).trim());
    var name = presetName || im.defaultPreset || '';
    var pre = name ? findPreset(name) : null;
    if (pre && pre.prompt && String(pre.prompt).trim()) parts.push(String(pre.prompt).trim());
    if (pre && pre.promptEnd && String(pre.promptEnd).trim()) parts.push(String(pre.promptEnd).trim());
    if (prompt && String(prompt).trim()) parts.push(String(prompt).trim());
    if (im.aqt && String(im.aqt).trim()) parts.push(String(im.aqt).trim());
    return dedupeTags(parts).join(', ');
  }

  /** 去重：按英文 tag 归一化后去除重复片段（智绘机会做 tag 去重） */
  function dedupeTags(parts) {
    var seen = {};
    var out = [];
    var joined = parts.filter(Boolean).join(', ');
    // 按逗号切分 tag（保留 :: 加权结构），逐段去重
    var segs = String(joined).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < segs.length; i++) {
      var key = segs[i].replace(/\s+/g, ' ').toLowerCase();
      if (key && seen[key]) continue;
      seen[key] = 1;
      out.push(segs[i]);
    }
    return out;
  }

  async function ensureNovelKey() {
    try {
      var zh = chatu8Settings();
      if (zh && zh.novelaiApi && !getSettings().skipKeySync) {
        await st('POST', '/api/secrets/write', { key: 'api_key_novel', value: zh.novelaiApi, label: 'st-chatu8 同步' });
        log('已同步 api_key_novel（来自智绘机）');
      }
    } catch (e) { log('api_key_novel 同步跳过:', e.message); }
  }

  /** 解压 zip，取第一张 PNG 的 base64（无头 data: 前缀） */
  async function unzipFirstPngToBase64(buf) {
    // 优先用 ST 全局 JSZip
    var JSZipLib = null;
    try { JSZipLib = (typeof window !== 'undefined' && window.JSZip) || null; } catch (e) {}
    if (JSZipLib && typeof JSZipLib.loadAsync === 'function') {
      var zip = await JSZipLib.loadAsync(buf);
      var files = zip.files || {};
      var names = Object.keys(files).filter(function (n) { return /\.png$/i.test(n); });
      if (!names.length) throw new Error('生图响应 zip 中没有 PNG');
      var blob = await files[names[0]].async('blob');
      var ab = await blob.arrayBuffer();
      return bytesToBase64(new Uint8Array(ab));
    }
    // 兜底：手写 zip 单文件解析 + deflate-raw 解压
    return unzipFirstPngRaw(buf);
  }

  function bytesToBase64(u8) {
    var CHUNK = 0x8000;
    var out = [];
    for (var i = 0; i < u8.length; i += CHUNK) {
      out.push(String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK)));
    }
    return btoa(out.join(''));
  }

  async function unzipFirstPngRaw(buf) {
    var u8 = new Uint8Array(buf);
    var dv = new DataView(buf);
    var off = 0;
    // 遍历本地文件头 PK\x03\x04
    while (off + 4 <= u8.length) {
      if (u8[off] === 0x50 && u8[off + 1] === 0x4b && u8[off + 2] === 0x03 && u8[off + 3] === 0x04) {
        var method = dv.getUint16(off + 8, true);
        var compSize = dv.getUint32(off + 18, true);
        var nameLen = dv.getUint16(off + 26, true);
        var extraLen = dv.getUint16(off + 28, true);
        var dataStart = off + 30 + nameLen + extraLen;
        var name = '';
        for (var i = 0; i < nameLen; i++) name += String.fromCharCode(u8[off + 30 + i]);
        if (/\.png$/i.test(name) && compSize > 0) {
          var compressed = u8.subarray(dataStart, dataStart + compSize);
          var raw = await inflateRaw(compressed);
          return bytesToBase64(raw);
        }
        off = dataStart + compSize;
      } else {
        off++;
      }
    }
    throw new Error('无法解析生图响应 zip');
  }

  async function inflateRaw(compressed) {
    if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持 deflate 解压');
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([compressed]).stream().pipeThrough(ds);
    var ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /** 直连 NovelAI API 生图（payload 结构与智绘机成功请求一致） */
  async function genImageDirect(args) {
    var im = imageConfig();
    var prompt = composePrompt(args.prompt, args.preset);
    var key = im.apiKey || '';
    if (!key) throw new Error('未填写 NovelAI API Key（设置 → 生图）');
    var seed = (args.seed != null && args.seed >= 0) ? args.seed : Math.floor(Math.random() * 2147483647);
    var negative = args.negative_prompt || im.negative_prompt || '';
    var model = args.model || im.model;
    // NAI 4.5 系列：不支持 SM/SMEA，payload 中不携带 sm/sm_dyn（与智绘机 4.5 请求一致），否则服务端 500
    var is45 = String(model).indexOf('4-5') >= 0 || String(model).indexOf('4.5') >= 0;
    // skip_cfg_above_sigma：智绘机按 模型/分辨率 计算（4.5 全尺寸 → 58）
    var skipCfg = is45 ? 58 : 0;
    var cap = { base_caption: prompt, char_captions: [] };
    var ncap = { base_caption: negative, char_captions: [] };
    var body = {
      input: prompt,
      model: model,
      parameters: {
        params_version: 3,
        negative_prompt: negative,
        height: args.height || im.height,
        width: args.width || im.width,
        scale: args.scale != null ? args.scale : im.scale,
        cfg_rescale: args.cfg_rescale != null ? args.cfg_rescale : im.cfg_rescale,
        sampler: args.sampler || im.sampler,
        steps: args.steps || im.steps,
        seed: seed,
        n_samples: 1,
        noise_schedule: args.scheduler || im.scheduler,
        autoSmea: false,
        normalize_reference_strength_multiple: false,
        inpaintImg2ImgStrength: 1,
        ucPreset: 3,
        qualityToggle: false,
        add_original_image: true,
        controlnet_strength: 1,
        dynamic_thresholding: false,
        legacy: false,
        legacy_uc: false,
        legacy_v3_extend: false,
        skip_cfg_above_sigma: skipCfg,
        use_coords: false,
        characterPrompts: [],
        reference_strength_multiple: [],
        reference_image_multiple_cached: [],
        reference_information_extracted_multiple: [],
        v4_negative_prompt: { caption: ncap, legacy_uc: false },
        v4_prompt: { caption: cap, use_coords: false, use_order: true },
      },
    };
    var res = await fetch(im.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      var errText = '';
      try { errText = (await res.text()).slice(0, 200); } catch (e) {}
      throw new Error('NovelAI ' + res.status + (errText ? ' ' + errText : ''));
    }
    var buf = await res.arrayBuffer();
    var b64 = await unzipFirstPngToBase64(buf);
    return { url: 'data:image/png;base64,' + b64 };
  }

  /** 走酒馆 NovelAI 代理（用户「在酒馆里测试生图」用的就是这条路径） */
  async function genImageViaProxy(args) {
    args = args || {};
    var im = imageConfig();
    var model = args.model || im.model;
    // NAI 4.5 系列：不支持 SM/SMEA，携带会 500（与 genImageDirect 一致）；需要 variety_boost 触发 skip_cfg
    var is45 = String(model).indexOf('4-5') >= 0 || String(model).indexOf('4.5') >= 0;
    await ensureNovelKey();
    var body = {
      prompt: composePrompt(args.prompt, args.preset),
      negative_prompt: args.negative_prompt || im.negative_prompt,
      model: model,
      width: args.width || im.width,
      height: args.height || im.height,
      steps: args.steps || im.steps,
      sampler: args.sampler || im.sampler,
      scheduler: args.scheduler || im.scheduler,
      sm: !is45 && (args.sm != null ? args.sm : im.sm),
      sm_dyn: !is45 && (args.sm_dyn != null ? args.sm_dyn : im.sm_dyn),
      decrisper: args.decrisper != null ? args.decrisper : im.decrisper,
      variety_boost: !!(args.variety_boost) || is45,
      seed: args.seed >= 0 ? args.seed : -1,
    };
    var data = await st('POST', '/api/novelai/generate-image', body);
    if (typeof data === 'string' && data.length > 100) {
      return { url: 'data:image/png;base64,' + data };
    }
    throw new Error('生图返回异常（酒馆代理）');
  }

  async function genImage(args) {
    args = args || {};
    var im = imageConfig();
    if (im.enabled === false && !args.force) throw new Error('生图已关闭（设置 → 生图开关）');
    var mode = args.mode || im.mode; // 支持单次指定模式
    if (mode === 'direct') {
      try {
        return await genImageDirect(args);
      } catch (e) {
        // 直连网络失败（CORS/断网，无 HTTP status）→ 自动回退酒馆代理（用户实测正常的路径）
        if (!(e && e.status)) {
          try { return await genImageViaProxy(args); } catch (e2) { throw e; }
        }
        throw e;
      }
    }
    return genImageViaProxy(args);
  }

  /* ---------------- 朋友圈（酒馆群组存储） ---------------- */
  async function ensureMomentsGroup() {
    var s = getSettings();
    if (s.momentsGroupId) {
      try {
        var groups0 = await st('POST', '/api/groups/all', {});
        var g0 = (groups0 || []).find(function (g) { return String(g.id) === String(s.momentsGroupId); });
        if (g0) return g0;
      } catch (e) {}
    }
    var groups = await st('POST', '/api/groups/all', {});
    var byName = (groups || []).find(function (g) { return g.name === MOMENTS_GROUP_NAME; });
    if (byName) { s.momentsGroupId = String(byName.id); saveSettings(); return byName; }
    var chars = await listCharacters();
    var members = [];
    var allChars = null; try { allChars = ctx().characters || []; } catch (e) {}
    for (var i = 0; i < (allChars || []).length; i++) {
      var a = allChars[i] && allChars[i].avatar;
      if (a && a !== 'none') members.push(a);
    }
    if (!members.length) members = ['none'];
    var created = await st('POST', '/api/groups/create', {
      name: MOMENTS_GROUP_NAME,
      members: members,
      allow_self_responses: false,
      activation_strategy: 0,
      generation_mode: 0,
      disabled_members: [],
      fav: false,
      chat_id: String(Date.now()),
      chats: [],
    });
    s.momentsGroupId = String(created.id);
    saveSettings();
    return created;
  }

  async function getMomentsChat() {
    var g = await ensureMomentsGroup();
    var chat = await st('POST', '/api/chats/group/get', { id: g.id });
    return { group: g, chat: Array.isArray(chat) ? chat : [] };
  }
  async function saveMomentsChat(g, chat) {
    return st('POST', '/api/chats/group/save', { id: g.id, chat: chat, force: true });
  }

  function nowIso() { return new Date().toISOString(); }

  function parseTagFields(mes) {
    var fields = {};
    var body = String(mes).replace(/^【朋友圈动态】|^【朋友圈评论】/, '').trim();
    // img= 的值可能是 data URL（含分号），特殊处理：取到行尾
    var imgMatch = body.match(/;img=([\s\S]*)$/);
    if (imgMatch) {
      body = body.replace(/;img=[\s\S]*$/, '');
      fields.img = imgMatch[1].trim();
    }
    var segs = body.split(';');
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var idx = seg.indexOf('=');
      if (idx > 0) {
        var k = seg.slice(0, idx).trim();
        var v = seg.slice(idx + 1).trim();
        if (k && !(k in fields)) {
          // 正文/评论/角色 写入时经 encodeURIComponent，这里还原（兼容未编码旧数据）
          if (k === '正文' || k === '评论' || k === '角色') {
            try { v = decodeURIComponent(v); } catch (e) {}
          }
          fields[k] = v;
        }
      }
    }
    return fields;
  }

  function parseMoments(chat) {
    var posts = [];
    var commentsByPost = {};
    var order = [];
    (chat || []).forEach(function (m) {
      var mes = (m.mes || '').trim();
      if (mes.indexOf('【朋友圈动态】') === 0) {
        var f = parseTagFields(mes);
        var post = {
          id: f.id || ('p' + order.length),
          character: f['角色'] || m.name || '未知角色',
          key: f.key || '',
          time: f['时间'] || m.send_date || '',
          text: f['正文'] || '',
          img: f.img || '',
          rawIndex: posts.length,
        };
        posts.push(post);
        order.push(post.id);
        commentsByPost[post.id] = [];
      } else if (mes.indexOf('【朋友圈评论】') === 0) {
        var f2 = parseTagFields(mes);
        var pid = f2['动态'] || '';
        var comment = {
          id: 'c' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          postId: pid,
          character: f2['角色'] || m.name || '未知角色',
          key: f2.key || '',
          time: f2['时间'] || m.send_date || '',
          text: f2['评论'] || '',
        };
        if (!commentsByPost[pid]) commentsByPost[pid] = [];
        commentsByPost[pid].push(comment);
      }
    });
    return posts.map(function (p) {
      return { id: p.id, character: p.character, key: p.key, time: p.time, text: p.text, img: p.img, comments: commentsByPost[p.id] || [] };
    }).sort(function (a, b) { return new Date(b.time || 0) - new Date(a.time || 0); });  // 最新在上
  }

  async function publishMoment(args) {
    args = args || {};
    if (!args.character || !args.text) throw new Error('角色与正文不能为空');
    var displayName = args.characterName || args.character;
    var g = await ensureMomentsGroup();
    var imgUrl = null;
    if (args.imgData && String(args.imgData).trim()) {
      // 本地上传图片：直接存 base64
      imgUrl = String(args.imgData).trim();
    } else if (args.imagePrompt && String(args.imagePrompt).trim()) {
      var r = await genImage({ prompt: String(args.imagePrompt).trim(), preset: args.preset, force: !!args.force });
      imgUrl = r.url;
    }
    var id = 'm' + Date.now() + Math.random().toString(16).slice(2, 8);
    // 正文 URL 编码（正文可能含 ; 或 =，会破坏字段分隔）
    var parts = ['【朋友圈动态】', 'id=' + id + ';', '角色=' + encodeURIComponent(displayName) + ';', 'key=' + args.character + ';', '时间=' + nowIso() + ';', '正文=' + encodeURIComponent(args.text)];
    if (imgUrl) parts.push(';img=' + imgUrl);
    var mes = parts.join('');
    var mesObj = { name: displayName, is_user: true, is_system: false, send_date: nowIso(), mes: mes, extra: { id: id, api: 'moments', model: 'wechat-st' } };
    var chat = (await getMomentsChat()).chat;
    chat.push(mesObj);
    await saveMomentsChat(g, chat);
    return { id: id, imgUrl: imgUrl };
  }

  async function addComment(args) {
    args = args || {};
    if (!args.momentId || !args.character || !args.text) throw new Error('缺少参数');
    var displayName = args.characterName || args.character;
    var g = await ensureMomentsGroup();
    var mes = '【朋友圈评论】动态=' + args.momentId + ';角色=' + encodeURIComponent(displayName) + ';key=' + args.character + ';时间=' + nowIso() + ';评论=' + encodeURIComponent(args.text);
    var mesObj = { name: displayName, is_user: true, is_system: false, send_date: nowIso(), mes: mes, extra: { id: 'c' + Date.now(), api: 'moments', model: 'wechat-st' } };
    var chat = (await getMomentsChat()).chat;
    chat.push(mesObj);
    await saveMomentsChat(g, chat);
    return { ok: true };
  }

  /** 删除一条朋友圈动态（按动态 id 匹配【朋友圈动态】消息，并连带删除其下的评论） */
  async function deleteMoment(momentId) {
    if (!momentId) throw new Error('缺少动态 id');
    var g = await ensureMomentsGroup();
    var r = await getMomentsChat();
    var chat = r.chat;
    var kept = chat.filter(function (m) {
      var mes = String(m.mes || '').trim();
      if (mes.indexOf('【朋友圈动态】') === 0) {
        var f = parseTagFields(mes);
        return f.id !== momentId;
      }
      if (mes.indexOf('【朋友圈评论】') === 0) {
        var f2 = parseTagFields(mes);
        return f2['动态'] !== momentId;
      }
      return true;
    });
    if (kept.length === chat.length) throw new Error('未找到该动态');
    await saveMomentsChat(g, kept);
    return { ok: true };
  }

  /** 删除一条评论（按动态 id + 时间戳 + 角色 key 定位） */
  async function deleteComment(momentId, commentTime, commentKey) {
    if (!momentId) throw new Error('缺少参数');
    var g = await ensureMomentsGroup();
    var r = await getMomentsChat();
    var chat = r.chat;
    var kept = chat.filter(function (m) {
      var mes = String(m.mes || '').trim();
      if (mes.indexOf('【朋友圈评论】') !== 0) return true;
      var f = parseTagFields(mes);
      if (f['动态'] !== momentId) return true;
      if (commentTime && f['时间'] === commentTime && f.key === commentKey) return false;
      return true;
    });
    if (kept.length === chat.length) throw new Error('未找到该评论');
    await saveMomentsChat(g, kept);
    return { ok: true };
  }

  async function aiComment(args) {
    args = args || {};
    if (!args.momentId || !args.character) throw new Error('缺少参数');
    var displayName = args.characterName || args.character;
    var charDesc = '';
    var chars = await listCharacters();
    var c = chars.find(function (x) { return x.key === args.character || x.name === args.character; });
    if (c && c.description) charDesc = c.description;
    if (c && c.personality) charDesc += (charDesc ? '\n' : '') + c.personality;
    var prompt = [
      args.isMe
        ? '你是微信朋友圈里的「' + displayName + '」（也就是用户本人/玩家），正在朋友圈里评论好友的动态。'
        : '你是「' + displayName + '」，正在微信朋友圈里评论好友的动态。你的名字就叫「' + displayName + '」，任何情况下都不要喊错自己的名字、不要自称或被当成其他角色。',
      args.isMe ? '' : (charDesc ? '你的性格设定：' + charDesc : ''),
      args.relation ? '你与这位好友的关系：' + args.relation + '（评论语气和称呼都要贴合这层关系，例如按关系用“老师/同期/恋人/同事”等合适的称呼，不要用错）' : '',
      '好友朋友圈内容：' + (args.momentText || '(无正文)'),
      '发布这条朋友圈的是「' + (args.posterName || '你的好友') + '」。',
      '评论中称呼对方用词必须符合「' + displayName + '」与「' + (args.posterName || '对方') + '」在原作/人设中的关系：如果是同期、同窗、同级或平辈，就直接叫名字或昵称（例如同期同学之间直接叫“杰”而不是“老师”），绝不要用“老师”“先生”“前辈”“大人”等职务或敬称，除非你们的关系设定里明确是师生/前后辈。',
      '但不要每条评论都机械地以对方名字或称呼开头：真实朋友圈评论大多数是直接开口说话（例如“明天我陪你去，但别点太甜的”“你请客？上次欠我的饮料钱还没还”），只有需要点名调侃、质问、强调或显得亲昵时才带上称呼（例如“悟，你欠我的报告呢”“杰，这次又是你请客？”）。评论要自然、口语化、风格多样，不要千篇一律都喊名字开头。',
      '务必围绕上面这条朋友圈内容本身来评论（内容相关、真实合理），不要跑题，不要编造朋友圈里没有发生的事，不要张冠李戴、不要喊错名字。',
      '严禁出现与评论内容无关的功能性或系统用语（如“撤回”“删除”“警告”“提示”“系统”等），评论必须是纯粹自然的朋友圈互动对话，像一个真人在刷朋友圈时随口说的话。',
      '请以「' + displayName + '」的口吻写一条简短的中文评论（30字以内），口语化、符合人设，直接开口说话，不要机械地在开头加对方名字/称呼，不要使用任何标记符号，不要加引号，只输出评论内容本身。',
    ].filter(Boolean).join('\n');
    var reply = await genChat([
      { role: 'system', content: '你是朋友圈评论助手。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.8, max_tokens: 200 });
    var text = String(reply.content || '').trim().replace(/^[「"'“”\s]+|[」"'“”\s]+$/g, '');
    return { text: text };
  }

  /* ---- AI 自动朋友圈：结合最近聊天，生成文案 + 生图提示词 ---- */
  async function genAutoMoment(args) {
    args = args || {};
    var character = args.character;
    var displayName = args.characterName || character;
    if (!character) throw new Error('请选择角色');
    var c = (await listCharacters()).find(function (x) { return x.key === character || x.name === character; });
    var persona = [];
    if (args.asMe) {
      if (args.meDesc) persona.push('你的身份（玩家本人）：' + args.meDesc);
    } else {
      if (c && c.description) persona.push('人设：' + c.description);
      if (c && c.personality) persona.push('性格：' + c.personality);
    }
    var meName = args.meName || '我';
    var chatStr = Array.isArray(args.recentChat) && args.recentChat.length
      ? args.recentChat.map(function (m) { return (m.is_user ? meName : displayName) + '：' + String(m.mes || ''); }).join('\n')
      : '(暂无最近聊天记录)';
    // 参考群聊：让角色根据群聊话题发朋友圈
    var groupStr = '';
    if (Array.isArray(args.groupChat) && args.groupChat.length) {
      groupStr = '你所在的群聊「' + (args.groupName || '') + '」最近聊了：\n' +
        args.groupChat.map(function (m) { return (m.is_user ? meName : (m.name || '')) + '：' + String(m.text || ''); }).join('\n') +
        '\n（你发朋友圈的内容可以围绕上面群聊里聊到的话题/趣事来写，自然一点，不用生硬地逐个提到群成员。）';
    }
    var imgTagLine = args.imgTag
      ? '该角色已配置的生图标签（必须原样放在提示词开头，作为固定锚点，用于保证画风/形象一致）：' + args.imgTag
      : '';
    var prompt = [
      args.asMe
        ? '你是微信朋友圈用户本人「' + meName + '」（玩家），现在想发一条朋友圈，内容围绕你与角色「' + displayName + '」的日常/刚才的聊天展开。'
        : '你正在扮演「' + displayName + '」，帮「' + displayName + '」发一条微信朋友圈。你的名字是「' + displayName + '」，不要喊错自己的名字，也不要混入或扮演其他角色。',
      persona.join('\n'),
      '最近聊天：\n' + chatStr,
      groupStr,
      args.hint ? '用户补充：' + args.hint : '',
      '请' + (args.asMe
        ? '以你自己（玩家「' + meName + '」）的第一人称口吻写：1) 一条中文朋友圈正文（口语化、像一个真实的人在发朋友圈，30~60字）；2) 一条用于配图的英文生图提示词（30词以内）。注意：你是玩家本人，绝对不要以「' + displayName + '」或其他角色的身份/口吻发朋友圈。'
        : '以「' + displayName + '」的口吻写：1) 一条中文朋友圈正文（口语化、符合人设，30~60字）；2) 一条用于配图的英文生图提示词（30词以内）。'),
      '配图英文生图提示词必须严格遵守以下格式规则：',
      IMG_PROMPT_RULES,
      imgTagLine,
      '朋友圈正文必须是发朋友圈时说出口/写下的字，绝对禁止任何括号动作、表情、神态、心理描写或旁白（例如不要写“（眨眼）”“（捂嘴笑）”“（看着手机）”“（递过）”，也不要写“（白井老师快看我真诚的大眼睛）”这类），不要用任何括号、星号、下划线等标记符号，纯文字、口语化、像一个真人在发朋友圈。',
      '只输出 JSON：{"text":"中文朋友圈正文","imgPrompt":"english image prompt"}',
    ].filter(Boolean).join('\n');
    var reply = await genChat([
      { role: 'system', content: '你是朋友圈内容策划助手，只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ], { temperature: 1.0, max_tokens: 300 });
    var content = String(reply.content || '').trim();
    var jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    var obj = null;
    try { obj = JSON.parse(jsonText); } catch (e) {}
    if (!obj || !obj.text) {
      var tm = content.match(/["']?text["']?\s*[:：]\s*["']([^"']+)["']/);
      var im = content.match(/["']?imgPrompt["']?\s*[:：]\s*["']([^"']+)["']/);
      obj = { text: tm ? tm[1] : content.slice(0, 60), imgPrompt: im ? im[1] : '' };
    }
    return { text: String(obj.text || '').trim(), imgPrompt: String(obj.imgPrompt || '').trim() };
  }

  /* ---------------- 公众号（酒馆群组存储，AI 按世界观写文） ---------------- */
  async function ensureArticlesGroup() {
    var s = getSettings();
    if (s.articlesGroupId) {
      try {
        var groups0 = await st('POST', '/api/groups/all', {});
        var g0 = (groups0 || []).find(function (g) { return String(g.id) === String(s.articlesGroupId); });
        if (g0) return g0;
      } catch (e) {}
    }
    var groups = await st('POST', '/api/groups/all', {});
    var byName = (groups || []).find(function (g) { return g.name === ARTICLES_GROUP_NAME; });
    if (byName) { s.articlesGroupId = String(byName.id); saveSettings(); return byName; }
    var chars = await listCharacters();
    var members = [];
    var allChars = null; try { allChars = ctx().characters || []; } catch (e) {}
    for (var i = 0; i < (allChars || []).length; i++) {
      var a = allChars[i] && allChars[i].avatar;
      if (a && a !== 'none') members.push(a);
    }
    if (!members.length) members = ['none'];
    var created = await st('POST', '/api/groups/create', {
      name: ARTICLES_GROUP_NAME,
      members: members,
      allow_self_responses: false,
      activation_strategy: 0,
      generation_mode: 0,
      disabled_members: [],
      fav: false,
      chat_id: String(Date.now()),
      chats: [],
    });
    s.articlesGroupId = String(created.id);
    saveSettings();
    return created;
  }
  async function getArticlesChat() {
    var g = await ensureArticlesGroup();
    var chat = await st('POST', '/api/chats/group/get', { id: g.id });
    return { group: g, chat: Array.isArray(chat) ? chat : [] };
  }
  async function saveArticlesChat(g, chat) {
    return st('POST', '/api/chats/group/save', { id: g.id, chat: chat, force: true });
  }
  function parseArticleTag(mes) {
    var fields = {};
    var body = String(mes).replace(/^【公众号文章】/, '').trim();
    var segs = body.split(';');
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var idx = seg.indexOf('=');
      if (idx > 0) {
        var k = seg.slice(0, idx).trim();
        var v = seg.slice(idx + 1).trim();
        if (k && !(k in fields)) {
          // 正文/封面/标题/公众号 写入时经 encodeURIComponent，这里还原；未编码的旧数据原样保留
          if (k === '正文' || k === '封面' || k === '标题' || k === '公众号') {
            try { v = decodeURIComponent(v); } catch (e) {}
          }
          fields[k] = v;
        }
      }
    }
    return fields;
  }
  async function getArticles() {
    var r = await getArticlesChat();
    var articles = (r.chat || []).map(function (m) {
      var mes = (m.mes || '').trim();
      if (mes.indexOf('【公众号文章】') !== 0) return null;
      var f = parseArticleTag(mes);
      return {
        id: f.id || ('a' + Date.now()),
        character: f['角色'] || m.name || '未知',
        author: f['公众号'] || '',
        key: f.key || '',
        time: f['时间'] || m.send_date || '',
        title: f['标题'] || '(无标题)',
        body: f['正文'] || '',
        cover: f['封面'] || '',
      };
    }).filter(Boolean).sort(function (a, b) { return new Date(b.time || 0) - new Date(a.time || 0); });
    return { articles: articles };
  }
  async function publishArticle(args) {
    args = args || {};
    if (!args.title || !args.body) throw new Error('标题与正文不能为空');
    var author = String(args.author || '').trim() || '未知公众号';
    var cover = String(args.cover || '').trim();
    var g = await ensureArticlesGroup();
    var id = 'a' + Date.now() + Math.random().toString(16).slice(2, 8);
    // 正文/封面含 ; 或 = 会破坏字段分隔，必须 encodeURIComponent 存储
    var mes = '【公众号文章】id=' + id + ';角色=公众号;key=;时间=' + nowIso() + ';公众号=' + encodeURIComponent(author) + ';标题=' + encodeURIComponent(args.title) + ';正文=' + encodeURIComponent(args.body) + (cover ? ';封面=' + encodeURIComponent(cover) : '');
    var mesObj = { name: author, is_user: true, is_system: false, send_date: nowIso(), mes: mes, extra: { id: id, api: 'articles', model: 'wechat-st' } };
    var chat = (await getArticlesChat()).chat;
    chat.push(mesObj);
    await saveArticlesChat(g, chat);
    return { id: id };
  }
  async function deleteArticle(articleId) {
    if (!articleId) throw new Error('缺少文章 id');
    var g = await ensureArticlesGroup();
    var r = await getArticlesChat();
    var kept = r.chat.filter(function (m) {
      var mes = String(m.mes || '').trim();
      if (mes.indexOf('【公众号文章】') !== 0) return true;
      var f = parseArticleTag(mes);
      return f.id !== articleId;
    });
    if (kept.length === r.chat.length) throw new Error('未找到该文章');
    await saveArticlesChat(g, kept);
    return { ok: true };
  }
  /** AI 生成公众号文章：营销号/技术号/探店号小编口吻，发布人由 AI 拟；不硬扯角色 */
  async function genArticle(args) {
    args = args || {};
    // 世界观素材：玩家账号的世界书/人设（提供世界观背景、地名、组织与热门话题）
    var meWorld = '';
    try { meWorld = args.meDesc || ''; } catch (e) {}
    var prompt = [
      '你是一个微信公众平台的内容小编，负责运营一个公众号（营销号/技术号/探店号风格），现在要写一篇推文。你只是公众号小编，不是任何角色本人，内容面向大众读者。',
      '素材：',
      args.hint ? '- 本期主题（用户给的）：' + args.hint : '',
      meWorld ? '- 世界观背景（用于了解世界的地名/组织/热门话题，不要照抄）：' + String(meWorld).slice(0, 1000) : '',
      '写作要求：',
      '1) 主题如果是探店、攻略、生活方式、美食、旅游、科技、日常技巧这类：就写成正经的探店/攻略/资讯内容，聚焦地点、店铺、体验、口味、价格、实用信息等，内容要有干货。绝对不要把内容硬往某个角色身上扯；除非该主题本身就是世界观里的热点新闻。',
      '2) 主题如果是世界观相关的热点新闻（例如"某家族新任家主上位""某组织重大事件"这类）：以小编报道的视角写，可用旁观者口吻提及相关角色/事件，但绝不站在任何角色第一人称口吻，不代入角色情绪。',
      '3) 标题要吸引眼球（如《震惊！…》《…深度解析》《…不为人知的秘密》《…探店指南》《…避雷》等），正文 200~400 字左右，自然分段。',
      '4) 绝对不要用任何 Markdown 标记（如 #、*、-），不要写括号动作/表情/心理描写，纯文字内容。',
      '5) 拟一个贴合题材/世界观设定的公众号名称（如「XX探店手册」「XX生存指南」「XX观察」这类，不要用角色名当公众号名）。',
      '6) 视角分层（非常重要）：这个世界存在「普通公众」和「知晓内情者」两类人。普通公众对这个世界隐藏的隐秘设定（超能力/魔法/灵异/咒力等，以提供给你的世界观背景为准）一无所知。默认按普通公众视角写作：探店、攻略、生活、美食、旅游、科技类内容，绝对不透露任何隐秘设定，也不要出现相关专有名词，最多用"这家店据说有点玄乎"这类都市传说式的调侃。只有当主题本身明确是内行话题（如该世界观的重要热点事件/组织新闻）时，才以知情的小编报道视角写作，且仍用旁观者口吻、不代入任何角色。',
      '只输出 JSON：{"author":"公众号名称","title":"标题（10~20字，吸引人）","body":"正文（纯文字，自然分段）"}',
    ].filter(Boolean).join('\n');
    var reply = await genChat([
      { role: 'system', content: '你是公众号文章写作助手，只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.9, max_tokens: 1500 });
    var content = String(reply.content || '').trim();
    var jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    var obj = null;
    try { obj = JSON.parse(jsonText); } catch (e) {}
    if (!obj || !obj.body) {
      var tm = content.match(/["']?title["']?\s*[:：]\s*["']([^"']+)["']/);
      var bm = content.match(/["']?body["']?\s*[:：]\s*["']([^"']+)["']/);
      var am = content.match(/["']?author["']?\s*[:：]\s*["']([^"']+)["']/);
      obj = { author: am ? am[1] : '', title: tm ? tm[1] : '深度好文', body: bm ? bm[1] : content.slice(0, 200) };
    }
    return {
      author: String(obj.author || '').trim(),
      title: String(obj.title || '').trim(),
      body: String(obj.body || '').trim(),
    };
  }

  /* ---- 酒馆用户设定（User Persona）与世界书 ---- */
  async function listPersonas() {
    var personas = (power_user && power_user.personas) || {};
    var descs = (power_user && power_user.persona_descriptions) || {};
    var out = [];
    for (var id in personas) {
      var d = descs[id] || {};
      var avatar = '';
      try { avatar = await avatarToDataURL('User Avatars/' + id); } catch (e) {}
      out.push({
        id: id,
        name: String(personas[id] || ''),
        description: String(d.description || d.title || ''),
        avatar: avatar,
        isDefault: (power_user && power_user.default_persona) === id,
      });
    }
    return out;
  }
  async function listWorldInfos() {
    var data = await st('POST', '/api/worldinfo/list', {});
    return (Array.isArray(data) ? data : []).map(function (w) { return { id: w.file_id, name: w.name }; });
  }
  async function getWorldInfoText(fileId) {
    if (!fileId) return '';
    var data = await st('POST', '/api/worldinfo/get', { name: fileId });
    var raw = (data && data.entries) || [];
    var entries = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { return raw[k]; });
    return entries.map(function (e) { return e.content || ''; }).filter(Boolean).join('\n');
  }
  async function getWorldInfoEntries(fileId) {
    if (!fileId) return [];
    var data = await st('POST', '/api/worldinfo/get', { name: fileId });
    var raw = (data && data.entries) || [];
    var entries = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { return raw[k]; });
    return entries.map(function (e) {
      return { id: e.uid, comment: e.comment || '', content: e.content || '', enabled: e.disable !== true && e.enabled !== false };
    });
  }

  /* ---------------- 会话文件（读 / 存 / 删） ---------------- */
  async function getChat(avatar, file) {
    // 先按指定 avatar 读
    try {
      var data = await st('POST', '/api/chats/get', { avatar_url: avatar, file_name: file });
      if (Array.isArray(data) && data.length) return data;
    } catch (e) { /* 落到下面扫描 */ }
    // 指定目录没有/为空时，扫描全部角色目录（兼容旧版本把会话存到其它同名卡目录的情况）
    var chars = await listCharacters();
    for (var i = 0; i < chars.length; i++) {
      var av = chars[i].avatar_file;
      if (!av || av === avatar) continue;
      try {
        var d2 = await st('POST', '/api/chats/get', { avatar_url: av, file_name: file });
        if (Array.isArray(d2) && d2.length) return d2;
      } catch (e2) { /* 继续扫 */ }
    }
    return [];
  }
  async function saveChat(avatar, file, chat) {
    return st('POST', '/api/chats/save', { avatar_url: avatar, file_name: file, chat: chat, force: true });
  }
  async function deleteChat(avatar, file) {
    // 先按指定 avatar 删除
    try {
      var r = await st('POST', '/api/chats/delete', { avatar_url: avatar, chatfile: file });
      if (r && r.ok) return r;
    } catch (e) { /* 落到下面扫描 */ }
    // 指定目录没有时，扫描全部角色目录（兼容旧版本把会话存到其它同名卡目录的情况）
    var chars = await listCharacters();
    for (var i = 0; i < chars.length; i++) {
      var av = chars[i].avatar_file;
      if (!av || av === avatar) continue;
      try {
        var r2 = await st('POST', '/api/chats/delete', { avatar_url: av, chatfile: file });
        if (r2 && r2.ok) return r2;
      } catch (e2) { /* 继续扫 */ }
    }
    // 都没找到文件：视为删除成功（本地记录照删，避免卡死）
    return { ok: true, skipped: true };
  }

  /* ---------------- 运行时配置 ---------------- */
  async function getConfig() {
    var im = imageConfig();
    var cc = chatConfig();
    var w = whitelistOf();
    var cfg = {
      stUrl: location.origin,
      imageEnabled: im.enabled,
      imageModel: im.model,
      imageMode: im.mode,
      imagePresets: im.presets.map(function (p) { return p && p.name; }).filter(Boolean),
      imageDefaultPreset: im.defaultPreset || '',
      chatModel: cc.model,
      whitelist: w,
      autoWhitelistTag: String(getSettings().autoWhitelistTag || '').trim(),
      whitelistExcluded: Array.isArray(getSettings().whitelistExcluded) ? getSettings().whitelistExcluded.map(String) : [],
      autoPost: !!getSettings().autoPost,
      autoComment: !!getSettings().autoComment,
      autoCommentMin: getSettings().autoCommentMin != null ? getSettings().autoCommentMin : 1,
      autoCommentMax: getSettings().autoCommentMax != null ? getSettings().autoCommentMax : 3,
      enableArticle: getSettings().enableArticle !== false,
      chatBg: getSettings().chatBg || '',
      aiBehavior: getSettings().aiBehavior || null,
      groupActive: getSettings().groupActive || null,
      showFab: getSettings().showFab !== false,
      isExtension: true,
    };
    try {
      var g = await ensureMomentsGroup();
      cfg.momentsGroup = { id: g.id, name: g.name };
    } catch (e) { log('获取朋友圈群组失败:', e.message); }
    return cfg;
  }

  /* =============================== 悬浮按钮 + 全屏 App =============================== */

  function applyFabPos(btn) {
    var s = getSettings();
    var p = s.fabPos;
    var w = window.innerWidth, h = window.innerHeight;
    var bw = btn.offsetWidth || 52, bh = btn.offsetHeight || 52;
    var cx = Math.max(4, Math.round((w - bw) / 2));
    var cy = Math.max(4, Math.round((h - bh) / 2));
    if (p && typeof p.x === 'number' && typeof p.y === 'number' && p.x <= w - bw && p.y <= h - bh) {
      // 存储位置当前仍在视口内：直接沿用
      btn.style.left = Math.max(0, p.x) + 'px';
      btn.style.top = Math.max(0, p.y) + 'px';
    } else {
      // 无记忆位置 / 位置已超出当前视口（换设备或窗口变小）：重置居中
      btn.style.left = cx + 'px';
      btn.style.top = cy + 'px';
    }
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }

  /** 悬浮按钮：长按/拖拽移动，短按打开（不依赖 click，兼容移动端 touch/pointer 丢失 click 的情况） */
  function enableFabDrag(btn, onTap) {
    var drag = { active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0, thresh: 8 };
    function down(e) {
      drag.active = true; drag.moved = false;
      drag.sx = e.clientX; drag.sy = e.clientY;
      var r = btn.getBoundingClientRect();
      drag.ox = r.left; drag.oy = r.top;
      // 触摸设备点击时手指会抖动，用更大的阈值避免误判为拖动；鼠标保持灵敏
      drag.thresh = (e.pointerType === 'touch') ? 14 : 6;
    }
    function move(e) {
      if (!drag.active) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && (Math.abs(dx) + Math.abs(dy)) > drag.thresh) drag.moved = true;
      if (!drag.moved) return;
      if (e.preventDefault) e.preventDefault();
      var x = Math.max(4, Math.min(window.innerWidth - btn.offsetWidth - 4, drag.ox + dx));
      var y = Math.max(4, Math.min(window.innerHeight - btn.offsetHeight - 4, drag.oy + dy));
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    }
    function up() {
      if (!drag.active) return;
      drag.active = false;
      if (drag.moved) {
        var s = getSettings();
        var r = btn.getBoundingClientRect();
        s.fabPos = { x: Math.round(r.left), y: Math.round(r.top) };
        saveSettings();
      } else if (onTap) {
        onTap(); // 短按（未拖动）：打开微信。不依赖 click，移动端稳定
      }
    }
    btn.addEventListener('pointerdown', down);
    // move/up 挂 window：手指/鼠标移出按钮也能继续拖动并正常结束
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // 短按已由 up 触发 onTap；这里吞掉 click，避免桌面端/移动端重复打开
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
    });
  }

  function buildLauncher() {
    if (document.getElementById(LAUNCHER_ID)) return;
    if (getSettings().showFab === false) return; // 用户关闭悬浮按钮
    var btn = document.createElement('div');
    btn.id = LAUNCHER_ID;
    btn.title = '打开微信';
    btn.innerHTML = '<span class="wxst-fab-icon">💬</span>';
    document.body.appendChild(btn);
    applyFabPos(btn);
    enableFabDrag(btn, openApp); // 短按打开（pointerup 触发，兼容移动端）
  }

  /** 在酒馆顶部「扩展」菜单加一个微信入口（即使悬浮按钮关闭也能打开） */
  function buildMenuEntry() {
    try {
      if (document.getElementById('wxst-menu-item')) return;
      var menu = document.getElementById('extensionsMenu');
      if (!menu) return;
      var item = document.createElement('div');
      item.id = 'wxst-menu-item';
      item.className = 'list-group-item';
      item.style.cssText = 'cursor:pointer;padding:8px 12px;display:flex;align-items:center;gap:8px;color:#fff;';
      item.innerHTML = '<span>💬</span><span>微信 · 打开</span>';
      item.onclick = function (e) {
        try {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          openApp();
        } catch (err) { log('打开微信失败:', err && err.message); }
        // 收起下拉
        var dd = document.getElementById('extensionsMenu');
        if (dd && window.jQuery) { try { jQuery(dd).fadeOut(100); } catch (err2) {} }
      };
      menu.appendChild(item);
    } catch (e) { log('构建扩展菜单入口失败:', e.message); }
  }

  /** 按「启用」总开关 + 悬浮窗开关，统一显示/隐藏 FAB 与菜单入口 */
  function applyEnabled() {
    var on = getSettings().enabled !== false;
    var fab = document.getElementById(LAUNCHER_ID);
    if (!on) {
      if (fab) fab.remove();
      var mi = document.getElementById('wxst-menu-item');
      if (mi) mi.remove();
      return;
    }
    if (getSettings().showFab === false) {
      if (fab) fab.remove();
    } else if (!fab) {
      buildLauncher();
    }
    if (!document.getElementById('wxst-menu-item')) buildMenuEntry();
  }

  /** 在酒馆「扩展程序」设置页注册微信配置块（含悬浮窗开关） */
  function ensureSettingsPanel() {
    try {
      var host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
      if (!host) return false;
      if (document.getElementById('wxst-ext-drawer')) return true;
      var s = getSettings();
      var wrap = document.createElement('div');
      wrap.id = 'wxst-ext-drawer';
      wrap.innerHTML =
        '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header">' +
          '<b><span class="fa-solid fa-comments" style="margin-right:6px"></span>微信 · WeChat for SillyTavern</b>' +
          '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>' +
          '<div class="inline-drawer-content">' +
            '<label class="checkbox_label"><input type="checkbox" id="wxst-cfg-enable"><span><b>启用扩展</b>（关闭后悬浮按钮与菜单入口隐藏）</span></label>' +
            '<label class="checkbox_label" style="margin-top:6px"><input type="checkbox" id="wxst-cfg-fab"><span><b>显示悬浮窗按钮</b>（右下角 💬）</span></label>' +
            '<div class="menu_button menu_button_icon interactable" id="wxst-cfg-open" style="width:100%;justify-content:center;margin-top:8px"><span class="fa-solid fa-comments"></span><span>打开微信</span></div>' +
            '<div class="menu_button menu_button_icon interactable" id="wxst-cfg-settings" style="width:100%;justify-content:center;margin-top:6px"><span class="fa-solid fa-gear"></span><span>打开完整设置</span></div>' +
          '</div></div>';
      host.appendChild(wrap);
      // 展开/收起交给 ST 原生 inline-drawer，勿自行绑定

      var en = wrap.querySelector('#wxst-cfg-enable');
      en.checked = s.enabled !== false;
      en.addEventListener('change', function () {
        getSettings().enabled = en.checked;
        saveSettings();
        applyEnabled();
        toast(en.checked ? '微信扩展已启用' : '微信扩展已停用', 'info');
      });

      var fab = wrap.querySelector('#wxst-cfg-fab');
      fab.checked = s.showFab !== false;
      fab.addEventListener('change', function () {
        getSettings().showFab = fab.checked;
        saveSettings();
        var f = document.getElementById(LAUNCHER_ID);
        if (fab.checked) { if (!f) buildLauncher(); }
        else if (f) f.remove();
        toast(fab.checked ? '已开启悬浮窗按钮' : '已关闭悬浮窗按钮（仍可从顶部「扩展」菜单打开微信）', 'info');
      });

      wrap.querySelector('#wxst-cfg-open').addEventListener('click', openApp);
      wrap.querySelector('#wxst-cfg-settings').addEventListener('click', openSettings);
      return true;
    } catch (e) { log('注册扩展设置块失败:', e.message); return false; }
  }

  function openApp() {
    try {
      if (document.getElementById(OVERLAY_ID)) { closeApp(); return; }
      // 全部内联样式 + vw/vh 单位：手机上酒馆页面存在带 transform 的祖先容器，
      // 会让 position:fixed 的百分比尺寸（width/height:100%）错乱成 0；vw/vh 始终相对视口，不受影响
      var overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:9999999;background:#ededed;display:flex;flex-direction:column;overflow:hidden;margin:0;padding:0;';
      var topbar = document.createElement('div');
      topbar.style.cssText = 'height:44px;flex:0 0 44px;width:100%;background:#ededed;display:flex;align-items:center;justify-content:space-between;padding:0 12px;box-sizing:border-box;border-bottom:0.5px solid rgba(0,0,0,.08);';
      topbar.innerHTML =
        '<span style="font-size:16px;font-weight:600;color:#111">微信 · WeChat</span>' +
        '<span style="display:flex;gap:6px">' +
          '<button id="wxst-btn-settings" type="button" style="background:#fff;border:1px solid #d9d9d9;border-radius:8px;font-size:14px;width:34px;height:30px;cursor:pointer;color:#333">⚙️</button>' +
          '<button id="wxst-btn-close" type="button" style="background:#fff;border:1px solid #d9d9d9;border-radius:8px;font-size:14px;width:34px;height:30px;cursor:pointer;color:#333">✕</button>' +
        '</span>';
      var iframe = document.createElement('iframe');
      iframe.id = 'wxst-frame';
      iframe.style.cssText = 'flex:1 1 auto;width:100%;height:calc(100vh - 44px);height:calc(100dvh - 44px);min-height:0;border:none;display:block;background:#fff;';
      iframe.src = APP_PATH + '?t=' + Date.now();
      overlay.appendChild(topbar);
      overlay.appendChild(iframe);
      // 挂到 html 元素而非 body：手机上 body 若带 transform/样式可能干扰 fixed 定位
      document.documentElement.appendChild(overlay);
      document.getElementById('wxst-btn-close').addEventListener('click', closeApp);
      document.getElementById('wxst-btn-settings').addEventListener('click', function () { openSettings(); });
      // overlay 已成功挂载后再隐藏悬浮标，避免打开失败导致悬浮键消失
      var fab = document.getElementById(LAUNCHER_ID);
      if (fab) fab.style.display = 'none';
      iframe.addEventListener('load', function () {
        try {
          var d = iframe.contentDocument;
          if (d && !d.getElementById('app')) {
            log('微信 iframe 已加载但未找到 #app（app 页面可能报错白屏）');
          }
        } catch (e) {}
      });
      iframe.addEventListener('error', function () {
        try { toast('微信页面加载失败，请确认手机能访问酒馆'); } catch (e) {}
      });
    } catch (e) {
      log('openApp 失败:', e && e.message);
      try { toast('微信打开失败：' + (e && e.message)); } catch (e2) {}
    }
  }

  function closeApp() {
    var o = document.getElementById(OVERLAY_ID);
    if (o) o.remove();
    var fab = document.getElementById(LAUNCHER_ID);
    if (fab) fab.style.display = ''; // 关闭后恢复悬浮标
  }

  /** 设置变更后刷新 app iframe（重新拉白名单/模型/生图配置） */
  function reloadApp() {
    var f = document.getElementById('wxst-frame');
    if (f && f.contentWindow) { try { f.contentWindow.location.reload(); } catch (e) {} }
  }

  /* =============================== 设置面板 =============================== */

  /** 同名角色展示名加后缀（与 listCharacters 一致） */
  function displayNameOf(c) {
    return c && c.displayName ? c.displayName : (c ? String(c.name || '') : '');
  }

  function escHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 扩展层自定义确认弹窗（替代浏览器 confirm，注入酒馆页面） */
  function wxstConfirm(msg, cb) {
    var id = 'wxst-confirm-' + Date.now();
    var wrap = document.createElement('div');
    wrap.id = id;
    wrap.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';
    wrap.innerHTML =
      '<div style="width:300px;max-width:80vw;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.2)">' +
        '<div style="padding:24px 18px;text-align:center;font-size:15px;color:#333;line-height:1.5">' + escHtml(msg) + '</div>' +
        '<div style="display:flex;border-top:1px solid #e5e5e5">' +
          '<button type="button" data-v="0" style="flex:1;padding:13px;border:none;background:#fff;font-size:15px;color:#666;cursor:pointer">取消</button>' +
          '<button type="button" data-v="1" style="flex:1;padding:13px;border:none;border-left:1px solid #e5e5e5;background:#fff;font-size:15px;color:#07C160;font-weight:600;cursor:pointer">确定</button>' +
        '</div>' +
      '</div>';
    function close() { if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { close(); cb && cb(false); }
    });
    wrap.querySelector('[data-v="0"]').addEventListener('click', function () { close(); cb && cb(false); });
    wrap.querySelector('[data-v="1"]').addEventListener('click', function () { close(); cb && cb(true); });
    document.body.appendChild(wrap);
  }

  function openSettings() {
    var old = document.getElementById(SETTINGS_ID);
    if (old) { old.remove(); }
    var s = getSettings();
    var chars = null; try { chars = ctx().characters || []; } catch (e) {}
    var curWhitelist = Array.isArray(s.whitelist) ? s.whitelist.map(String) : null;
    var chat = s.chat || {};
    var im = s.image || {};
    var cfg = chatConfig();
    var imCfg = imageConfig();

    // 白名单行：value=key(avatar 文件名)，label=展示名（同名加后缀）
    var nameCount = {};
    (chars || []).forEach(function (c) { nameCount[c.name] = (nameCount[c.name] || 0) + 1; });
    var seen = {};
    var charRows = (chars || []).map(function (c) {
      var key = String(c.avatar || c.name);
      var label = c.name;
      if (nameCount[c.name] > 1) {
        seen[c.name] = (seen[c.name] || 0) + 1;
        label = c.name + (seen[c.name] > 1 ? ' #' + seen[c.name] : '');
      }
      var checked = !curWhitelist || curWhitelist.indexOf(key) >= 0 || curWhitelist.indexOf(String(c.name)) >= 0;
      return '<label class="wxst-row" title="' + escHtml(c.avatar || c.name) + '"><input type="checkbox" class="wxst-wl" value="' + escHtml(key) + '"' + (checked ? ' checked' : '') + '> <span>' + escHtml(label) + '</span></label>';
    }).join('');

    // 预设提示词行
    var presets = Array.isArray(im.presets) ? im.presets : [];
    function presetRow(p, i) {
      p = p || {};
      return '<div class="wxst-preset" data-i="' + i + '">' +
        '<div class="wxst-preset-head"><input class="wxst-ps-name" placeholder="预设名（如：日漫风）" value="' + escHtml(p.name) + '">' +
        '<button class="wxst-mini-btn wxst-ps-del" type="button">删除</button></div>' +
        '<textarea class="wxst-ps-prompt" rows="2" placeholder="正面提示词（拼在 AI 提示词前面）">' + escHtml(p.prompt) + '</textarea>' +
        '<input class="wxst-ps-neg" placeholder="该预设专属负面提示词（可留空，用全局负面）" value="' + escHtml(p.neg) + '">' +
      '</div>';
    }
    var presetHtml = presets.map(function (p, i) { return presetRow(p, i); }).join('') +
      '<div class="wxst-preset-empty" style="display:' + (presets.length ? 'none' : 'block') + ';color:#999;font-size:12px">暂无预设，点下方「＋ 添加预设」新增（如：赛璐璐风、厚涂风、写实风…）</div>';

    var modal = document.createElement('div');
    modal.id = SETTINGS_ID;
    modal.innerHTML =
      '<div class="wxst-settings-mask">' +
        '<div class="wxst-settings-card">' +
          '<div class="wxst-settings-head">微信 · 设置' +
            '<span class="wxst-settings-close" id="wxst-set-close">✕</span>' +
          '</div>' +
          '<div class="wxst-settings-body">' +
            '<div class="wxst-set-section"><div class="wxst-set-title">悬浮按钮</div>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-showfab"' + (s.showFab !== false ? ' checked' : '') + '> 显示右下角悬浮按钮</label>' +
            '</div>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">通讯录</div>' +
              '<label>自动加入通讯录的 tag <input id="wxst-auto-wl-tag" value="' + escHtml(s.autoWhitelistTag || '') + '" placeholder="留空关闭。如填 wechat：打该 tag 的角色自动出现在通讯录"></label>' +
              '<div class="wxst-set-tip">在酒馆「角色管理」给角色打上 tag 后，这里填同一个 tag，角色会自动加入通讯录（无需逐个点同意）；也可在「新朋友」里移除（会记住排除）。</div>' +
            '</div>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">聊天</div>' +
              '<label>全局聊天背景 <input id="wxst-chatbg" value="' + escHtml(s.chatBg || '') + '" placeholder="色值如 #E8E8E8 或图片 URL；每个角色也可在「角色详情 → 聊天背景」单独设置"></label>' +
            '</div>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">AI 回复行为</div>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-ai-delay"' + (s.aiBehavior && s.aiBehavior.delayReply ? ' checked' : '') + '> 后台回复延迟（分享消息/主动推送不立即回，像真人隔一会再回）</label>' +
              '<label>延迟范围（秒） <input id="wxst-ai-delay-min" type="number" min="5" value="' + ((s.aiBehavior && s.aiBehavior.delayMin) || 30) + '">～<input id="wxst-ai-delay-max" type="number" min="10" value="' + ((s.aiBehavior && s.aiBehavior.delayMax) || 180) + '"></label>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-ai-skip"' + (s.aiBehavior && s.aiBehavior.skipReply ? ' checked' : '') + '> 选择性不回（部分消息 AI 可能不回，模拟真人忙/不想回）</label>' +
              '<label>不回概率（%） <input id="wxst-ai-skip-rate" type="number" min="0" max="100" value="' + ((s.aiBehavior && s.aiBehavior.skipRate) || 20) + '"></label>' +
              '<div class="wxst-set-tip">私信默认必回；勾选上面的开关后，分享/群/主动推送的回复会按概率延迟或不回。你在聊天页当面发消息始终立即回。</div>' +
            '</div>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">群活跃（AI 自发聊天）</div>' +
              '<label>发消息后 AI 连聊轮数（最少～最多，每轮 1~2 条） <input id="wxst-ga-chatmin" type="number" min="0" max="10" value="' + ((s.groupActive && s.groupActive.chatMin) != null ? s.groupActive.chatMin : 1) + '">～<input id="wxst-ga-chatmax" type="number" min="1" max="12" value="' + ((s.groupActive && s.groupActive.chatMax) != null ? s.groupActive.chatMax : 3) + '"></label>' +
              '<label>「🔥群活跃」按钮聊天轮数（最少～最多） <input id="wxst-ga-spontmin" type="number" min="1" max="10" value="' + ((s.groupActive && s.groupActive.spontMin) || 3) + '">～<input id="wxst-ga-spontmax" type="number" min="1" max="12" value="' + ((s.groupActive && s.groupActive.spontMax) || 6) + '"></label>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-ga-aigroup"' + ((s.groupActive && s.groupActive.aiGroupEnabled) ? ' checked' : '') + '> AI 主动拉群：角色会自发创建新群（AI 是群主）</label>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-ga-aimanage"' + ((s.groupActive && s.groupActive.aiManage) ? ' checked' : '') + '> 聊天执行群管理：成员在群里说「把XX设为/取消管理员」「转让群主给XX」会真实生效</label>' +
              '<label>AI 拉群频率（每 N 小时最多 1 次） <input id="wxst-ga-aigrouphours" type="number" min="1" max="720" value="' + ((s.groupActive && s.groupActive.aiGroupHours) || 24) + '"></label>' +
              '<label>AI 拉群触发概率（0~1，0.5=一半机会） <input id="wxst-ga-aigroupchance" type="number" min="0" max="1" step="0.1" value="' + ((s.groupActive && s.groupActive.aiGroupChance) != null ? s.groupActive.aiGroupChance : 0.5) + '"></label>' +
              '<div class="wxst-set-tip">聊天轮数=成员轮流接话的轮数。想群里更热闹就把数值调大（如发消息后 1~4 轮）。AI 主动拉群开启后，角色会随机拉新群并当群主，群里成员会自然开场。</div>' +
            '</div>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">朋友圈</div>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-autopost"' + (s.autoPost ? ' checked' : '') + '> AI 自动发圈：生成草稿后直接发布（不勾选 = 生成后先预览再确认）</label>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-autocomment"' + (s.autoComment ? ' checked' : '') + '> 发圈后 AI 自动让相关角色评论/点赞（不用自己逐条点）</label>' +
              '<label>AI 评论角色数（随机，最少～最多） <input id="wxst-autocomment-min" type="number" min="0" max="8" value="' + (s.autoCommentMin != null ? s.autoCommentMin : 1) + '">～<input id="wxst-autocomment-max" type="number" min="1" max="8" value="' + (s.autoCommentMax != null ? s.autoCommentMax : 3) + '"></label>' +
            '</div>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">公众号</div>' +
              '<label class="wxst-row"><input type="checkbox" id="wxst-enable-article"' + (s.enableArticle !== false ? ' checked' : '') + '> 启用公众号（微信底部出现「公众号」Tab，AI 按世界观写推文、可转发到私信讨论）</label>' +
            '</div>' +
            '<details class="wxst-set-section wxst-collapse"' + ((chat.source || chat.model) ? ' open' : '') + '>' +
              '<summary class="wxst-set-title">聊天模型（默认用酒馆当前配置）</summary>' +
              '<label>来源 <input id="wxst-chat-source" value="' + escHtml(chat.source || '') + '" placeholder="留空用酒馆默认"></label>' +
              '<label>API 地址 <input id="wxst-chat-url" value="' + escHtml(chat.custom_url || '') + '" placeholder="' + escHtml(cfg.custom_url) + '"></label>' +
              '<label>模型 <input id="wxst-chat-model" value="' + escHtml(chat.model || '') + '" placeholder="' + escHtml(cfg.model) + '"></label>' +
              '<label>温度 <input id="wxst-chat-temp" type="number" step="0.1" min="0" max="2" value="' + (chat.temperature != null ? chat.temperature : '') + '" placeholder="0.9"></label>' +
              '<label>最大 Token <input id="wxst-chat-max" type="number" min="64" step="16" value="' + (chat.max_tokens || '') + '" placeholder="1024"></label>' +
              '<div class="wxst-set-tip">这里全部留空 = 完全用你酒馆里配好的模型；改过这里才会覆盖酒馆设置。</div>' +
            '</details>' +
            '<div class="wxst-set-section"><div class="wxst-set-title">生图（NovelAI）' +
              '<label class="wxst-row wxst-inline"><input type="checkbox" id="wxst-img-enabled"' + (getSettings().imageEnabled !== false ? ' checked' : '') + '> 启用生图（关闭后隐藏所有删除功能与配图入口）</label>' +
            '</div>' +
              '<div class="wxst-preset-pick">' +
                '<label>用哪个预设 <select id="wxst-img-preset-sel"><option value="">默认</option></select></label>' +
                '<button class="wxst-mini-btn wxst-import-zh" id="wxst-import-zh" type="button">↺ 一键导入智绘机预设与参数</button>' +
              '</div>' +
              '<div class="wxst-set-tip">导入后在上面下拉里选预设（如「漫画风」「写实」）即可发朋友圈用。想微调再展开「自定义生图」。</div>' +
              '<details class="wxst-set-adv"><summary class="wxst-set-title">自定义生图（进阶，平时不用动）</summary>' +
                '<label>生图方式 <select id="wxst-img-mode">' +
                  '<option value="proxy"' + (imCfg.mode === 'direct' ? '' : ' selected') + '>走酒馆代理（用酒馆/智绘机的 key）</option>' +
                  '<option value="direct"' + (imCfg.mode === 'direct' ? ' selected' : '') + '>直连 NovelAI API（填下面自己的 key）</option>' +
                '</select></label>' +
                '<label>API 地址 <input id="wxst-img-url" value="' + escHtml(im.apiUrl || '') + '" placeholder="' + escHtml(imCfg.apiUrl) + '"></label>' +
                '<label>API Key <input id="wxst-img-key" type="password" value="' + escHtml(im.apiKey || '') + '" placeholder="直连模式必填"></label>' +
                '<label>基础正面提示词 <textarea id="wxst-img-base" rows="2" placeholder="例如：masterpiece, best quality">' + escHtml(im.basePrompt || '') + '</textarea></label>' +
                '<label>模型 <input id="wxst-img-model" value="' + escHtml(im.model || '') + '" placeholder="' + escHtml(imCfg.model) + '"></label>' +
                '<label>宽 <input id="wxst-img-w" type="number" value="' + (im.width || '') + '" placeholder="' + imCfg.width + '">　高 <input id="wxst-img-h" type="number" value="' + (im.height || '') + '" placeholder="' + imCfg.height + '"></label>' +
                '<label>步数 <input id="wxst-img-steps" type="number" value="' + (im.steps || '') + '" placeholder="' + imCfg.steps + '">　采样器 <input id="wxst-img-sampler" value="' + escHtml(im.sampler || '') + '" placeholder="' + escHtml(imCfg.sampler) + '"></label>' +
                '<label>调度器 <input id="wxst-img-scheduler" value="' + escHtml(im.scheduler || '') + '" placeholder="' + escHtml(imCfg.scheduler) + '"></label>' +
                '<label>负面提示词 <textarea id="wxst-img-neg" rows="2" placeholder="' + escHtml(imCfg.negative_prompt) + '">' + escHtml(im.negative_prompt || '') + '</textarea></label>' +
                '<label>质量标签 AQT（自动加在提示词末尾） <input id="wxst-img-aqt" value="' + escHtml(im.aqt || imCfg.aqt || '') + '"></label>' +
                '<label class="wxst-row"><input type="checkbox" id="wxst-img-sm"' + (im.sm != null ? (im.sm ? ' checked' : '') : (imCfg.sm ? ' checked' : '')) + '> sm</label>' +
                '<label class="wxst-row"><input type="checkbox" id="wxst-img-smdy"' + (im.sm_dyn != null ? (im.sm_dyn ? ' checked' : '') : (imCfg.sm_dyn ? ' checked' : '')) + '> sm_dyn</label>' +
                '<div class="wxst-set-subtitle">预设列表（发朋友圈可选）</div>' +
                '<div class="wxst-preset-list" id="wxst-img-presets">' + presetHtml + '</div>' +
                '<button class="wxst-mini-btn" id="wxst-ps-add" type="button">＋ 添加预设</button>' +
              '</details>' +
            '</div>' +
            '<div class="wxst-set-tip">通讯录白名单已挪到微信 App 里管理：通讯录页右上角「＋」→ 新朋友，点「同意」加入即可。</div>' +
          '</div>' +
          '<div class="wxst-settings-foot">' +
            '<button class="wxst-btn" id="wxst-set-reset">重置默认</button>' +
            '<button class="wxst-btn wxst-btn-primary" id="wxst-set-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    // 挂载到 documentElement（与微信 overlay 同级）：手机上 body 带 transform 会形成独立层叠上下文，
    // 若挂 body 则设置面板永远被 overlay 盖住（“夹在中间”）。挂 documentElement 才能用 z-index 公平竞争。
    (document.documentElement || document.body).appendChild(modal);
    // 内联强制全屏遮罩+居中：绕开移动端 CSS 缓存/transform 干扰（与 overlay 同机制）
    try {
      var maskEl = modal.querySelector('.wxst-settings-mask');
      if (maskEl) maskEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:99999999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;margin:0;padding:0;';
      var cardEl = modal.querySelector('.wxst-settings-card');
      if (cardEl) cardEl.style.cssText = 'width:min(560px,92vw);max-height:86vh;max-height:86dvh;background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.25);';
    } catch (e3) { log('设置面板内联样式失败:', e3 && e3.message); }

    // 预设下拉：填充并选中默认预设
    function fillPresetSel(selectDefault) {
      var sel = document.getElementById('wxst-img-preset-sel');
      if (!sel) return;
      sel.innerHTML = '<option value="">默认</option>';
      (imageConfig().presets).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.name; o.textContent = p.name;
        sel.appendChild(o);
      });
      var def = selectDefault || getSettings().image && getSettings().image.defaultPreset || imageConfig().defaultPreset;
      if (def && sel.querySelector('option[value="' + def.replace(/"/g, '\\"') + '"]')) sel.value = def;
    }
    fillPresetSel();

    document.getElementById('wxst-set-close').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target.classList && e.target.classList.contains('wxst-settings-mask')) modal.remove(); });

    // 预设增删
    function reindexPresets() {
      document.querySelectorAll('#wxst-img-presets .wxst-preset').forEach(function (el, i) { el.dataset.i = i; });
      var empty = document.querySelector('#wxst-img-presets .wxst-preset-empty');
      var has = document.querySelectorAll('#wxst-img-presets .wxst-preset').length > 0;
      if (empty) empty.style.display = has ? 'none' : 'block';
    }
    document.getElementById('wxst-ps-add').addEventListener('click', function () {
      var listEl = document.getElementById('wxst-img-presets');
      var div = document.createElement('div');
      div.className = 'wxst-preset';
      div.innerHTML = '<div class="wxst-preset-head"><input class="wxst-ps-name" placeholder="预设名（如：日漫风）">' +
        '<button class="wxst-mini-btn wxst-ps-del" type="button">删除</button></div>' +
        '<textarea class="wxst-ps-prompt" rows="2" placeholder="正面提示词（拼在 AI 提示词前面）"></textarea>' +
        '<input class="wxst-ps-neg" placeholder="该预设专属负面提示词（可留空）">';
      listEl.insertBefore(div, listEl.querySelector('.wxst-preset-empty'));
      reindexPresets();
    });
    // 从智绘机一键导入：导入后刷新预设下拉并选中当前预设
    document.getElementById('wxst-import-zh').addEventListener('click', function () {
      try {
        var r = importFromChatu8();
        fillPresetSel(r.defaultPreset);
        toast('已导入 ' + (r.presets || []).length + ' 个预设（默认「' + (r.defaultPreset || '无') + '」）' + (r.hasKey ? '，含 API Key' : '') + '，请点保存', 'info');
      } catch (e) {
        toast('导入失败：' + e.message, 'error');
      }
    });
    modal.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('wxst-ps-del')) {
        var row = e.target.closest('.wxst-preset');
        if (row) row.remove();
        reindexPresets();
      }
    });

    document.getElementById('wxst-set-reset').addEventListener('click', function () {
      wxstConfirm('确定重置全部设置？', function (ok) {
        if (!ok) return;
        try { delete ctx().extensionSettings[EXT_KEY]; } catch (e) {}
        saveSettings();
        modal.remove();
        reloadApp();
        toast('已重置，请重新打开设置', 'success');
      });
    });

    document.getElementById('wxst-set-save').addEventListener('click', function () {
      // 收集预设
      var presetsOut = [];
      document.querySelectorAll('#wxst-img-presets .wxst-preset').forEach(function (el) {
        var name = (el.querySelector('.wxst-ps-name').value || '').trim();
        var prompt = (el.querySelector('.wxst-ps-prompt').value || '').trim();
        var neg = (el.querySelector('.wxst-ps-neg').value || '').trim();
        if (name) presetsOut.push({ name: name, prompt: prompt, neg: neg || undefined });
      });
      s.showFab = document.getElementById('wxst-showfab').checked;
      s.imageEnabled = document.getElementById('wxst-img-enabled').checked;
      s.chat = {
        source: document.getElementById('wxst-chat-source').value.trim() || undefined,
        custom_url: document.getElementById('wxst-chat-url').value.trim() || undefined,
        model: document.getElementById('wxst-chat-model').value.trim() || undefined,
        temperature: document.getElementById('wxst-chat-temp').value === '' ? undefined : Number(document.getElementById('wxst-chat-temp').value),
        max_tokens: document.getElementById('wxst-chat-max').value === '' ? undefined : Number(document.getElementById('wxst-chat-max').value),
      };
      s.image = {
        defaultPreset: document.getElementById('wxst-img-preset-sel').value || undefined,
        mode: document.getElementById('wxst-img-mode').value,
        apiUrl: document.getElementById('wxst-img-url').value.trim() || undefined,
        apiKey: document.getElementById('wxst-img-key').value.trim() || undefined,
        basePrompt: document.getElementById('wxst-img-base').value.trim() || undefined,
        presets: presetsOut.length ? presetsOut : undefined,
        model: document.getElementById('wxst-img-model').value.trim() || undefined,
        width: document.getElementById('wxst-img-w').value === '' ? undefined : Number(document.getElementById('wxst-img-w').value),
        height: document.getElementById('wxst-img-h').value === '' ? undefined : Number(document.getElementById('wxst-img-h').value),
        steps: document.getElementById('wxst-img-steps').value === '' ? undefined : Number(document.getElementById('wxst-img-steps').value),
        sampler: document.getElementById('wxst-img-sampler').value.trim() || undefined,
        scheduler: document.getElementById('wxst-img-scheduler').value.trim() || undefined,
        negative_prompt: document.getElementById('wxst-img-neg').value.trim() || undefined,
        aqt: document.getElementById('wxst-img-aqt').value.trim() || undefined,
        sm: document.getElementById('wxst-img-sm').checked,
        sm_dyn: document.getElementById('wxst-img-smdy').checked,
      };
      s.autoPost = document.getElementById('wxst-autopost').checked;
      s.autoComment = document.getElementById('wxst-autocomment').checked;
      var _amin = Math.max(0, Number(document.getElementById('wxst-autocomment-min').value) || 1);
      var _amax = Math.min(8, Math.max(_amin, Number(document.getElementById('wxst-autocomment-max').value) || 3));
      s.autoCommentMin = _amin;
      s.autoCommentMax = _amax;
      s.autoCommentN = _amax;
      var eaEl = document.getElementById('wxst-enable-article');
      if (eaEl) s.enableArticle = eaEl.checked;
      var tagEl = document.getElementById('wxst-auto-wl-tag');
      if (tagEl) s.autoWhitelistTag = String(tagEl.value || '').trim();
      var bgEl = document.getElementById('wxst-chatbg');
      if (bgEl) s.chatBg = String(bgEl.value || '').trim();
      // AI 回复行为
      var aiDelay = document.getElementById('wxst-ai-delay');
      var aiSkip = document.getElementById('wxst-ai-skip');
      if (aiDelay || aiSkip) {
        var dmin = Math.max(5, Number(document.getElementById('wxst-ai-delay-min').value) || 30);
        var dmax = Math.max(dmin, Number(document.getElementById('wxst-ai-delay-max').value) || 180);
        var srate = Math.min(100, Math.max(0, Number(document.getElementById('wxst-ai-skip-rate').value) || 20));
        s.aiBehavior = {
          delayReply: !!(aiDelay && aiDelay.checked),
          delayMin: dmin,
          delayMax: dmax,
          skipReply: !!(aiSkip && aiSkip.checked),
          skipRate: srate,
        };
      }
      // 群活跃
      var gaMinEl = document.getElementById('wxst-ga-chatmin');
      if (gaMinEl) {
        var chatMin = Math.max(0, Number(document.getElementById('wxst-ga-chatmin').value) || 1);
        var chatMax = Math.max(chatMin, Number(document.getElementById('wxst-ga-chatmax').value) || 3);
        var spontMin = Math.max(1, Number(document.getElementById('wxst-ga-spontmin').value) || 3);
        var spontMax = Math.max(spontMin, Number(document.getElementById('wxst-ga-spontmax').value) || 6);
        var aiGroupEnabled = !!document.getElementById('wxst-ga-aigroup').checked;
        var aiGroupHours = Math.max(1, Number(document.getElementById('wxst-ga-aigrouphours').value) || 24);
        var aiGroupChance = Math.min(1, Math.max(0, Number(document.getElementById('wxst-ga-aigroupchance').value) || 0.5));
        var aiManage = !!document.getElementById('wxst-ga-aimanage').checked;
        s.groupActive = { chatMin: chatMin, chatMax: chatMax, spontMin: spontMin, spontMax: spontMax, aiGroupEnabled: aiGroupEnabled, aiGroupHours: aiGroupHours, aiGroupChance: aiGroupChance, aiManage: aiManage };
      }
      // 清理空对象
      Object.keys(s.chat).forEach(function (k) { if (s.chat[k] === undefined) delete s.chat[k]; });
      Object.keys(s.image).forEach(function (k) { if (s.image[k] === undefined) delete s.image[k]; });
      if (!Object.keys(s.chat).length) delete s.chat;
      if (!Object.keys(s.image).length) delete s.image;
      saveSettings();
      charCache = null; // 白名单变了，刷新角色缓存
      modal.remove();
      reloadApp();
      // 按 showFab 显示/隐藏悬浮按钮
      var fab = document.getElementById(LAUNCHER_ID);
      if (s.showFab === false) { if (fab) fab.remove(); }
      else { buildLauncher(); }
      toast('设置已保存', 'success');
    });
  }

  /* =============================== 微信群聊（复用酒馆 group 存储 + 单模型多角色生成） =============================== */
  var GROUP_PREFIX = '微信群聊-';
  /** 群元信息（存酒馆设置）：name -> {name, memberKeys, adminKeys, muted:{key:untilTs}, kicked:{key:ts}, createdAt} */
  function groupMeta() {
    var s = getSettings();
    if (!s.groups || typeof s.groups !== 'object') s.groups = {};
    return s.groups;
  }
  function charKeyOf(c) { return String(c && (c.key || c.avatar_file || c.name) || ''); }

  async function ensureWeChatGroup(name) {
    var fullName = GROUP_PREFIX + name;
    var groups = await st('POST', '/api/groups/all', {});
    var g = (groups || []).find(function (x) { return String(x.name) === fullName; });
    if (g) return g;
    var chars = await listCharacters();
    var meta = groupMeta()[name] || {};
    var keys = meta.memberKeys || [];
    var members = [];
    for (var i = 0; i < keys.length; i++) {
      var c = (chars || []).find(function (x) { return charKeyOf(x) === keys[i]; });
      if (c && c.avatar && c.avatar !== 'none') members.push(c.avatar);
    }
    if (!members.length) members = ['none'];
    var created = await st('POST', '/api/groups/create', {
      name: fullName, members: members, allow_self_responses: true,
      activation_strategy: 0, generation_mode: 0, disabled_members: [], fav: false,
      chat_id: String(Date.now()), chats: [],
    });
    return created;
  }
  async function getGroupChatRaw(g) {
    var chat = await st('POST', '/api/chats/group/get', { id: g.id });
    return Array.isArray(chat) ? chat : [];
  }
  async function saveGroupChatRaw(g, chat) {
    return st('POST', '/api/chats/group/save', { id: g.id, chat: chat, force: true });
  }
  function parseGroupMessages(chat) {
    var out = [];
    (chat || []).forEach(function (m, i) {
      var mes = String(m.mes || '').trim();
      if (mes.indexOf('【群聊】') !== 0) return;
      var body = mes.replace(/^【群聊】/, '').trim();
      var fields = {};
      var segs = body.split(';');
      for (var j = 0; j < segs.length; j++) {
        var idx = segs[j].indexOf('=');
        if (idx > 0) { var k = segs[j].slice(0, idx).trim(); var v = segs[j].slice(idx + 1).trim(); if (k && !(k in fields)) fields[k] = v; }
      }
      function de(v) { try { return decodeURIComponent(v); } catch (e) { return v; } }
      var text = fields['内容'] || '';
      var card = null;
      // 新格式（saveWeChatMessage 统一编码存储）带 meta 字段；旧格式无 meta 字段 → 原样读取
      if ('meta' in fields) {
        if (fields['meta']) { try { card = JSON.parse(de(fields['meta'])); } catch (e) { card = null; } }
        text = de(text);
      }
      out.push({
        name: fields['角色'] || m.name || '',
        key: fields['key'] || '',
        time: fields['时间'] || m.send_date || '',
        text: text,
        card: card,
        isSystem: fields['key'] === '__system__',
        _rawIndex: i,
      });
    });
    return out;
  }
  async function listWeChatGroups() {
    var meta = groupMeta();
    var groups = await st('POST', '/api/groups/all', {});
    var names = Object.keys(meta);
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var g = (groups || []).find(function (x) { return String(x.name) === GROUP_PREFIX + name; });
      var msgs = g ? parseGroupMessages(await getGroupChatRaw(g)) : [];
      var last = msgs[msgs.length - 1];
      out.push({
        name: name,
        displayName: (meta[name] && meta[name].displayName) || name,
        avatar: (meta[name] && meta[name].avatar) || '',
        memberKeys: (meta[name] && meta[name].memberKeys) || [],
        createdAt: (meta[name] && meta[name].createdAt) || 0,
        unread: (meta[name] && meta[name].unread) || 0,
        lastPreview: last ? (last.name + '：' + cleanGroupText(last.text)) : '',
        lastTime: last ? last.time : 0,
        msgCount: msgs.length,
      });
    }
    return out;
  }
  async function createWeChatGroup(name, memberKeys, ownerKey) {
    name = String(name || '').trim();
    if (!name) throw new Error('群名不能为空');
    var meta = groupMeta();
    if (meta[name]) throw new Error('已存在同名群');
    if (!Array.isArray(memberKeys) || !memberKeys.length) throw new Error('至少要选一个群成员');
    // owner 为群主（拉群的人 / AI 拉群的角色）；群主默认进管理员
    meta[name] = {
      name: name, memberKeys: memberKeys,
      adminKeys: ownerKey ? [ownerKey] : [],
      owner: ownerKey || null,
      muted: {}, kicked: {}, createdAt: Date.now(),
    };
    saveSettings();
    await ensureWeChatGroup(name);
    return meta[name];
  }
  async function deleteWeChatGroup(name) {
    var meta = groupMeta();
    delete meta[name];
    saveSettings();
    // 尽量删掉酒馆 group（失败不影响本地记录）
    try {
      var groups = await st('POST', '/api/groups/all', {});
      var g = (groups || []).find(function (x) { return String(x.name) === GROUP_PREFIX + name; });
      if (g) await st('POST', '/api/groups/delete', { id: g.id });
    } catch (e) { log('删除群组失败:', e.message); }
  }
  async function getWeChatGroup(name) {
    var meta = groupMeta()[name];
    if (!meta) return null;
    var g = await ensureWeChatGroup(name);
    var msgs = parseGroupMessages(await getGroupChatRaw(g));
    // 统一清洗：显示与喂 AI 历史都干净（存储保持原始可追溯）
    msgs.forEach(function (x) { x.text = cleanGroupText(x.text); });
    var chars = await listCharacters();
    var members = (meta.memberKeys || []).map(function (key) {
      var c = (chars || []).find(function (x) { return charKeyOf(x) === key; });
      return { key: key, name: c ? c.name : key, avatar: c ? c.avatar : '' };
    });
    return { name: name, meta: meta, members: members, messages: msgs };
  }
  async function saveWeChatMessage(name, msg) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    var g = await ensureWeChatGroup(name);
    var chat = await getGroupChatRaw(g);
    // 统一 URL 编码存储：内容/卡片可含任意字符（; = 等不再破坏解析）；card 支持转发卡片；system 标记系统通知
    var cardJson = msg.card ? JSON.stringify(msg.card) : '';
    chat.push({
      name: msg.name, is_user: false, is_system: !!msg.system, send_date: new Date().toISOString(),
      mes: '【群聊】群=' + name + ';角色=' + (msg.name || '') + ';key=' + (msg.key || '') + ';时间=' + new Date().toISOString() +
           ';meta=' + encodeURIComponent(cardJson) +
           ';内容=' + encodeURIComponent(String(msg.text || '')),
    });
    await saveGroupChatRaw(g, chat);
    // 非玩家消息 → 群未读 +1（用户打开群 / 正在看时前端会清零）
    if (String(msg.key || '').indexOf('__me__') !== 0) {
      meta.unread = (meta.unread || 0) + 1;
      saveSettings();
    }
  }

  /* ---------------- 群信息 / 管理（改名、头像、公告、管理员、禁言、踢人） ---------------- */
  async function getWeChatGroupInfo(name) {
    var meta = groupMeta()[name];
    if (!meta) return null;
    return { name: name, meta: meta };
  }
  async function updateWeChatGroup(name, patch) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    if (patch && typeof patch === 'object') Object.assign(meta, patch);
    saveSettings();
    return meta;
  }
  async function setGroupAdmin(name, key, isAdmin) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    var arr = meta.adminKeys || (meta.adminKeys = []);
    var i = arr.indexOf(key);
    if (isAdmin) { if (i < 0) arr.push(key); } else if (i >= 0) arr.splice(i, 1);
    saveSettings();
    return meta;
  }
  /** 转让群主：新群主成为 owner 并自动进管理员；旧群主保留为普通成员。
   *  玩家（__me__ 开头）即使不在成员列表也视为有效新群主（玩家是实际使用者，自动入群） */
  async function transferGroupOwner(name, newOwnerKey) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    if (!newOwnerKey) throw new Error('缺少新群主');
    var isPlayer = String(newOwnerKey).indexOf('__me__') === 0;
    if (!isPlayer && meta.memberKeys.indexOf(newOwnerKey) < 0) throw new Error('新群主必须是群成员');
    if (meta.memberKeys.indexOf(newOwnerKey) < 0) meta.memberKeys.push(newOwnerKey);
    meta.owner = newOwnerKey;
    var arr = meta.adminKeys || (meta.adminKeys = []);
    if (arr.indexOf(newOwnerKey) < 0) arr.push(newOwnerKey);
    saveSettings();
    return meta;
  }
  async function muteGroupMember(name, key, untilTs) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    if (!meta.muted) meta.muted = {};
    if (untilTs && untilTs > Date.now()) meta.muted[key] = untilTs; else delete meta.muted[key];
    saveSettings();
    return meta;
  }
  async function kickGroupMember(name, key) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    meta.memberKeys = (meta.memberKeys || []).filter(function (k) { return k !== key; });
    var ai = meta.adminKeys || [];
    var j = ai.indexOf(key);
    if (j >= 0) ai.splice(j, 1);
    if (meta.muted) delete meta.muted[key];
    saveSettings();
    // 同步酒馆 group 成员（失败不影响本地记录）
    try {
      var g = await ensureWeChatGroup(name);
      var chars = await listCharacters();
      var members = [];
      for (var i = 0; i < (meta.memberKeys || []).length; i++) {
        var c = (chars || []).find(function (x) { return charKeyOf(x) === meta.memberKeys[i]; });
        if (c && c.avatar && c.avatar !== 'none') members.push(c.avatar);
      }
      if (!members.length) members = ['none'];
      await st('POST', '/api/groups/update', { id: g.id, members: members });
    } catch (e) { log('踢人同步群组失败:', e.message); }
    return meta;
  }
  /** 拉人进群：memberKeys 追加 + 同步酒馆 group 成员头像 */
  async function addGroupMember(name, key) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    var keys = meta.memberKeys || (meta.memberKeys = []);
    if (keys.indexOf(key) < 0) keys.push(key);
    saveSettings();
    try {
      var g = await ensureWeChatGroup(name);
      var chars = await listCharacters();
      var members = [];
      for (var i = 0; i < keys.length; i++) {
        var c = (chars || []).find(function (x) { return charKeyOf(x) === keys[i]; });
        if (c && c.avatar && c.avatar !== 'none') members.push(c.avatar);
      }
      if (!members.length) members = ['none'];
      await st('POST', '/api/groups/update', { id: g.id, members: members });
    } catch (e) { log('拉人同步群组失败:', e.message); }
    return meta;
  }
  async function clearGroupUnread(name) {
    var meta = groupMeta()[name];
    if (meta) { meta.unread = 0; saveSettings(); }
  }
  /** 删除群里指定原始索引的消息（长按菜单"删除/重说"用） */
  async function deleteWeChatMessage(name, idx) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    var g = await ensureWeChatGroup(name);
    var chat = await getGroupChatRaw(g);
    idx = parseInt(idx, 10);
    if (!(idx >= 0 && idx < chat.length)) return;
    chat.splice(idx, 1);
    await saveGroupChatRaw(g, chat);
  }
  /** 清空群聊天记录（保留群信息与成员） */
  async function clearWeChatGroupMessages(name) {
    var meta = groupMeta()[name];
    if (!meta) throw new Error('群不存在');
    var g = await ensureWeChatGroup(name);
    await saveGroupChatRaw(g, []);
    meta.unread = 0;
    saveSettings();
  }
  function formatTimeStr(d, tz) {
    try {
      return d.toLocaleString('zh-CN', { timeZone: tz || 'Asia/Shanghai', hour12: false, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toLocaleString('zh-CN'); }
  }
  /** 群 AI 生成：单模型多角色轮流接话。members: [{key,name,relation}]；返回 [{key,text}] */
  async function genGroupReply(args) {
    var name = args.groupName;
    var members = args.members || [];
    var messages = args.messages || [];
    var meName = args.meName || '我';
    var timezone = args.timezone || 'Asia/Shanghai';
    var announcement = args.announcement || '';
    var event = args.event || '';
    var mentioned = args.mentioned || [];   // 最新消息 @ 了谁（成员微信名列表）；'@all' 表示全员
    if (!members.length) throw new Error('群里没有成员');
    var chars = await listCharacters();
    // 成员名（微信备注名）→ 真实角色 key 映射：AI 输出的是名字，落库必须用 key，否则头像/身份对不上
    var keyByName = {};
    members.forEach(function (m) { keyByName[m.name] = m.key; });
    // 玩家别名：历史里玩家可能被写成「玩家」「我」等，都映射到玩家 key（__me__ 开头那个成员）
    members.forEach(function (m) {
      if (String(m.key).indexOf('__me__') === 0) {
        keyByName['玩家'] = m.key;
        keyByName['我'] = m.key;
      }
    });
    (chars || []).forEach(function (x) { if (!keyByName[x.name]) keyByName[x.name] = charKeyOf(x); });
    // 别名：角色名最后一个字（≥3 字时）也映射到同一 key，兼容 AI 用简称/尾字指代角色
    Object.keys(keyByName).forEach(function (nm) {
      if (!nm || nm.length < 3) return;
      var last = nm.slice(-1);
      if (/[\u4e00-\u9fa5]/.test(last) && !/子|人|的|们|君|桑/.test(last) && !keyByName[last]) {
        keyByName[last] = keyByName[nm];
      }
    });
    // 成员设定压缩为一句，避免长文本被模型抄写
    var memberLines = members.map(function (m) {
      var c = (chars || []).find(function (x) { return charKeyOf(x) === m.key; });
      var desc = '';
      if (c) {
        var d = String(c.description || '').trim();
        var p = String(c.personality || '').trim();
        desc = (d || p).slice(0, 90);
      }
      return m.name + (m.relation ? '（和我的关系：' + m.relation + '）' : '') + (desc ? '：' + desc : '');
    }).join('\n');
    var historyLines = messages.slice(-20).map(function (m) {
      var isMe = String(m.key || '').indexOf('__me__') === 0;
      return (isMe ? meName : m.name) + '：' + m.text;
    }).join('\n');
    var timeStr = formatTimeStr(new Date(), timezone);
    var ann = announcement ? '\n群公告：' + announcement : '';
    var evt = event ? '\n刚刚发生：' + event : '';
    var mentionNote = '';
    if (mentioned && mentioned.length) {
      if (mentioned.indexOf('@all') >= 0) mentionNote = '\n【注意】用户最新消息 @了全员，所有成员都必须回应，不能只回一个。\n';
      else mentionNote = '\n【注意】用户最新消息 @了：' + mentioned.join('、') + '。被 @ 的成员必须第一个回应，其他人可以视情况补充或不回。\n';
    }
    var system = '你是一个微信群聊模拟器，群名「' + name + '」。请扮演群里成员，模拟他们在微信里的真实聊天。\n' +
      '\n' +
      '【群成员】（只用于理解每个角色的性格，严禁把设定原文或规则输出给用户）：\n' + memberLines + ann + evt + '\n' +
      '【重要】只有上面【群成员】里列出的角色在这个群里。其他人即使被提到（比如"把XX拉进来""拉上XX"），只要不在这个列表里，就一律视为还没进群、不在群里，千万不要说"他/她就在群里"或"已经在群里"。\n' +
      '【当前真实时间】' + timeStr + '（比如深夜收到"晚安"会觉得奇怪，但不要刻意把时间说出来）。\n' +
      '【最近群消息】\n' + (historyLines || '（群聊刚开始，有人可以先自然开口）') + '\n' + mentionNote +
      '\n' +
      '现在模拟群成员对最新一条消息的自然反应，直接输出他们说的话。要求：\n' +
      '1. 就像真实微信群**成员之间互相接话聊天**，而不是每个人都去回复玩家。先看群里最新一条消息是谁发的（可能是玩家，也可能是某个成员），优先围绕**最新那条消息**回应；可以接别人刚说的话（比如 A 刚说完，B 接着 A 的话吐槽/补充），形成自然的对话链条。\n' +
      '2. 随机选 1~2 个成员接话（先让最可能先开口的人说，比如最关心这个话题、回得最快的人），通常 1 条就够，最多 2 条。\n' +
      '3. 如果是新成员自我介绍，就自然地欢迎或调侃；如果是开群公告，就自然回应公告内容。\n' +
      '4. 每条以「角色=成员名;内容=说的话」开头（注意：开头的「角色=」是固定的三个字，等号后面才写成员名，比如「角色=硝子;内容=...」；不要把成员名写在等号前面），多条用「|||」分隔。\n' +
      '5. 只输出说的话本身（就是微信消息），一句或两句，简短自然，口语化，贴合角色性格。\n' +
      '6. 成员在说话时可以用「@成员名」@ 别人（像微信一样@对方），对方下一轮会接话；但不要每条都@。@ 玩家时必须用他的微信名「@' + meName + '」，绝不要写成「@玩家」。\n' +
      '7. 绝对禁止输出：任何解释、规则、设定原文、自我介绍、括号、星号、引号、旁白、示例、开头结尾客套话；说话内容里不要带「XX：」这类名字前缀。\n' +
      '【格式示例】\n' +
      '用户消息：我回来了\n' +
      '正确输出：角色=硝子;内容=回来得挺早嘛\n' +
      '（以上只是格式示例，不要照抄示例内容，也不要把它发出来）';
    var data = await genChat([
      { role: 'system', content: system },
      { role: 'user', content: '请现在开始模拟群成员接话。' },
    ], { temperature: 0.75, max_tokens: 512 });
    var content = String(data.content || '').trim();
    var bubbles = content.split('|||').map(function (p) { return p.trim(); }).filter(Boolean);
    var firstKey = members[0].key;
    // 解析成员消息：兼容「角色=名字;内容=…」与模型跑偏的「名字=全名;内容=…」两种前缀
    function parseRoleMsg(b) {
      var m = String(b || '').match(/^(?:角色\s*=\s*([^;]{1,20})|([^=;，。、\s]{1,10})\s*=\s*([^;=]{0,20}))\s*;?\s*内容\s*=\s*([\s\S]*)$/);
      if (!m) return null;
      return {
        roleName: (m[1] || m[2] || '').trim().replace(/[（(].*$/, '').trim(),
        text: m[4],
      };
    }
    var result = [];
    bubbles.forEach(function (b) {
      var pm = parseRoleMsg(b);
      var key = firstKey, text = b;
      if (pm) {
        key = (pm.roleName && keyByName[pm.roleName]) || firstKey; // 名字→真实 key，头像/身份才正确
        text = pm.text;
      }
      text = cleanGroupText(text);
      // 启发式过滤：疑似泄漏/超长说明直接丢弃
      if (!text || text.length > 300 || /(TA的设定|TA 的设定|【现在开始】|【群成员设定】|姓名：|性别：|身高：|出生地：|入学等级：)/.test(text)) return;
      result.push({ key: key, text: text });
    });
    // 模型确实返回了但全被过滤（可能只是几句跑偏的规则）→ 取过滤前第一条兜底
    if (!result.length && bubbles.length) {
      var b0 = bubbles[0];
      var pm0 = parseRoleMsg(b0);
      var k0 = (pm0 && pm0.roleName && keyByName[pm0.roleName]) || firstKey;
      var t0 = cleanGroupText(pm0 ? pm0.text : b0);
      if (t0) result.push({ key: k0, text: t0 });
    }
    return result;
  }

  /** 清洗群消息文本：去除格式残留、括号、星号、元话语整行 */
  function cleanGroupText(s) {
    var t = String(s || '').trim();
    t = t.replace(/^角色=[^;]*;\s*内容=/, '');
    // 兼容模型跑偏前缀「角色=角色名;内容=」这类残留
    t = t.replace(/^[^=;，。]{1,10}=[^;=]{0,20}\s*;?\s*内容\s*=\s*/, '');
    // 全局清除残留在任意位置的「角色=xxx」标记片段
    t = t.replace(/(^|[，。；、\s])(角色\s*=\s*[^;，。；、\s]{1,12})\s*/g, '$1');
    // 去掉行首「XX：」这类名字前缀（如"硝子：杰哥..."→"杰哥..."）
    t = t.replace(/(^|[\n，。；])\s*[^\s：，。！？、\n]{1,8}：/g, '$1');
    t = t.replace(/[（(][^（）()]*[）)]/g, '');
    t = t.replace(/\*+[^*]*\*+/g, '');
    var lines = t.split('\n').map(function (x) { return x.trim(); }).filter(function (x) {
      if (!x) return false;
      if (/^(严禁|不要|请(不|勿|务必)?|可以|不可以|不允许|记住|请注意?|规则|设定|示例|开始|输出|要求|以上|以下|现在请|绝对|必须|禁止|格式|协议|群公告|任务|参考)/.test(x)) return false;
      return true;
    });
    return lines.join(' ').trim();
  }

  /* =============================== 桥接 API（供 iframe 内的前端调用） =============================== */

  window.WXBRIDGE = {
    getConfig: getConfig,
    getSettings: function () { return getSettings(); },
    saveAppSettings: function (patch) { Object.assign(getSettings(), patch || {}); saveSettings(); return true; },
    listCharacters: listCharacters,
    isAllowed: isAllowed,
    whitelistOf: whitelistOf,
    getChat: getChat,
    saveChat: saveChat,
    deleteChat: deleteChat,
    genChat: genChat,
    genImage: genImage,
    debugPrompt: function (prompt, preset) {
      try { return JSON.stringify({ pos: composePrompt(prompt || '', preset || ''), neg: imageConfig().negative_prompt || '', presetName: preset || '', defaultPreset: imageConfig().defaultPreset || '', presets: imageConfig().presets.map(function (p) { return p.name; }) }); }
      catch (e) { return 'ERR ' + (e.message || e); }
    },
    getMoments: function () {
      return getMomentsChat().then(function (r) { return { group: { id: r.group.id, name: r.group.name }, posts: parseMoments(r.chat) }; });
    },
    publishMoment: publishMoment,
    addComment: addComment,
    deleteMoment: deleteMoment,
    deleteComment: deleteComment,
    aiComment: aiComment,
    genAutoMoment: genAutoMoment,
    getArticles: function () { return getArticles(); },
    publishArticle: publishArticle,
    deleteArticle: deleteArticle,
    genArticle: genArticle,
    listPersonas: listPersonas,
    listWorldInfos: listWorldInfos,
    getWorldInfoText: getWorldInfoText,
    getWorldInfoEntries: getWorldInfoEntries,
    listWeChatGroups: listWeChatGroups,
    getWeChatGroup: getWeChatGroup,
    createWeChatGroup: createWeChatGroup,
    deleteWeChatGroup: deleteWeChatGroup,
    saveWeChatMessage: saveWeChatMessage,
    genGroupReply: genGroupReply,
    getWeChatGroupInfo: getWeChatGroupInfo,
    updateWeChatGroup: updateWeChatGroup,
    setGroupAdmin: setGroupAdmin,
    transferGroupOwner: transferGroupOwner,
    muteGroupMember: muteGroupMember,
    addGroupMember: addGroupMember,
    kickGroupMember: kickGroupMember,
    clearGroupUnread: clearGroupUnread,
    deleteWeChatMessage: deleteWeChatMessage,
    clearWeChatGroupMessages: clearWeChatGroupMessages,
    importFromChatu8: importFromChatu8,
    openSettings: openSettings,
    closeApp: closeApp,
    log: log,
  };

  /* =============================== 启动 =============================== */

  function init() {
    applyEnabled();
    ensureSettingsPanel();
    // ST 扩展菜单/设置容器是异步构建的，稍后重试几次确保入口挂上
    setTimeout(function () { buildMenuEntry(); ensureSettingsPanel(); }, 1500);
    setTimeout(function () { buildMenuEntry(); ensureSettingsPanel(); }, 4000);
    log('扩展已加载 · 点悬浮 💬 打开微信');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
