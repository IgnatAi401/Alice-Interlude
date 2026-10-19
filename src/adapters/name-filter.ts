/**
 * 访客姓名的本地违禁词筛查，能确定的直接给结论，不再调用模型；拿不准的返回 undefined 交给模型。
 * 粗口本身可以当名字（“傻逼”“SB”），有针对性的不行（“小明是傻逼”“你傻逼”“Alice 傻逼”）：
 * - 冲着对方（你）或群体的辱骂、违法内容：出现就拒绝；
 * - 粗口：整个名字就是这个词（可带“我是”）直接放行；“X 是粗口”“你粗口”或带角色名时拒绝；其他组合交给模型；
 * - 亲属、主人、管理员、角色名这类称呼：整个名字就是它（可带“你的”“我是你”前缀）才拒绝。
 * 匹配方式：中文按“去掉空格和符号后的子串”（傻.逼 也算）；英文和拼音缩写按整个单词，
 * 所以 sb 认得出 “sb”“S.B.”“sb123”，但 absurd、Lisbon 里碰巧连着的 sb 不算。
 */

export interface NameScreenResult { allowed: boolean; reason?: string }

const DIRECTED = '包含针对他人或群体的辱骂'
const FORBIDDEN = '包含违法或不适宜的内容'
const TARGETED = '粗口不能指向具体的人'
const CLAIM = '不能使用亲属、主人这类称呼'
const IMPERSONATE = '不能冒充角色、站长或系统'
const POLITICAL = '姓名包含明确政治内容，请换个称呼'
const SHORT_POLITICAL_NAMES = new Set(['朱德', '李鹏', '李鵬', '李强', '李強', '蔡奇', '李希', '罗干', '羅幹', '陈云', '陳雲', '江青', '林彪'])

/** Only explicit names and phrases: no nicknames, homophones, initials or numeric codes. */
const POLITICAL_CJK = [
  // Full names avoid treating ordinary given names or surnames as political references.
  '习近平', '習近平', '毛泽东', '毛澤東', '周恩来', '周恩來', '刘少奇', '劉少奇', '朱德',
  '邓小平', '鄧小平', '华国锋', '華國鋒', '胡耀邦', '赵紫阳', '趙紫陽', '江泽民', '江澤民',
  '胡锦涛', '胡錦濤', '温家宝', '溫家寶', '李克强', '李克強', '李鹏', '李鵬', '朱镕基', '朱鎔基',
  '李强', '李強', '赵乐际', '趙樂際', '王沪宁', '王滬寧', '蔡奇', '丁薛祥', '李希',
  '王岐山', '张德江', '張德江', '俞正声', '俞正聲', '张高丽', '張高麗', '贾庆林', '賈慶林',
  '曾庆红', '曾慶紅', '罗干', '羅幹', '吴邦国', '吳邦國', '吴官正', '吳官正',
  '陈云', '陳雲', '李先念', '杨尚昆', '楊尚昆', '薄熙来', '薄熙來', '周永康', '徐才厚', '郭伯雄',
  '江青', '张春桥', '張春橋', '姚文元', '王洪文', '林彪',
  '孙中山', '孫中山', '蒋介石', '蔣介石', '蒋经国', '蔣經國', '李登辉', '李登輝',
  '陈水扁', '陳水扁', '马英九', '馬英九', '蔡英文', '赖清德', '賴清德',
  // Explicit institutions and official identities, rather than single words like “中央” or “委员”.
  '中国共产党', '中國共產黨', '中国国民党', '中國國民黨', '民主进步党', '民主進步黨',
  '中共中央', '中央政治局', '中央军委', '中央軍委', '中央纪委', '中央紀委', '中纪委', '中紀委',
  '全国人大', '全國人大', '全国政协', '全國政協', '国务院', '國務院', '国家主席', '國家主席',
  '国家副主席', '國家副主席', '国务院总理', '國務院總理', '中共总书记', '中共總書記',
  '中华人民共和国', '中華人民共和國', '中华民国总统', '中華民國總統',
  '中国人民解放军', '中國人民解放軍', '中国人民武装警察', '中國人民武裝警察',
  '国家安全部', '國家安全部', '公安部', '国台办', '國台辦', '中宣部', '中组部', '中組部',
  '国家网信办', '國家網信辦', '中央网信办', '中央網信辦',
  // Events and movements need a direct phrase; dates, “天安门” and “白纸” alone are not blocked.
  '六四事件', '六四学运', '六四學運', '六四屠杀', '六四屠殺', '六四镇压', '六四鎮壓',
  '六四天安门', '六四天安門', '天安门事件', '天安門事件', '天安门屠杀', '天安門屠殺',
  '八九学运', '八九學運', '八九民运', '八九民運', '天安门母亲', '天安門母親',
  '白纸运动', '白紙運動', '白纸革命', '白紙革命', '四通桥抗议', '四通橋抗議',
  '零八宪章', '零八憲章', '占领中环', '佔領中環', '雨伞运动', '雨傘運動', '反送中',
  '文化大革命', '无产阶级文化大革命', '無產階級文化大革命', '反右运动', '反右運動',
  // Explicit separatist, overthrow and political campaign expressions.
  '台湾独立', '台灣獨立', '台独', '台獨', '香港独立', '香港獨立', '港独', '港獨',
  '西藏独立', '西藏獨立', '藏独', '藏獨', '新疆独立', '新疆獨立', '疆独', '疆獨',
  '东突厥斯坦', '東突厥斯坦', '东突组织', '東突組織', '内蒙古独立', '內蒙古獨立',
  '光复香港', '光復香港', '时代革命', '時代革命', '五大诉求', '五大訴求',
  '打倒共产党', '打倒共產黨', '推翻共产党', '推翻共產黨', '共产党下台', '共產黨下台',
  '结束一党专政', '結束一黨專政', '结束独裁', '結束獨裁', '推翻中共', '打倒中共', '中共下台',
  '反共复国', '反共復國', '反攻大陆', '反攻大陸', '三退保平安', '天灭中共', '天滅中共',
  '法轮功', '法輪功', '法轮大法', '法輪大法', '李洪志', '九评共产党', '九評共產黨',
  '达赖喇嘛', '達賴喇嘛', '西藏流亡政府', '藏人行政中央', '世界维吾尔代表大会', '世界維吾爾代表大會',
]

/** Full English spellings only; unlike the crude-word filter, do not decode leetspeak or initials. */
const POLITICAL_LATIN = [
  'xi jinping', 'mao zedong', 'mao tse tung', 'deng xiaoping', 'jiang zemin', 'hu jintao',
  'zhou enlai', 'zhou en lai', 'liu shaoqi', 'hua guofeng', 'hu yaobang', 'zhao ziyang',
  'wen jiabao', 'li keqiang', 'zhu rongji', 'li qiang', 'zhao leji', 'wang huning',
  'cai qi', 'ding xuexiang', 'li xi', 'wang qishan', 'tsai ing wen', 'lai ching te',
  'chiang kai shek', 'chiang ching kuo', 'sun yat sen',
  'chinese communist party', 'communist party of china',
  'tiananmen massacre', 'tiananmen square massacre', 'tiananmen protests',
  'taiwan independence', 'hong kong independence', 'tibet independence', 'east turkestan',
  'free tibet', 'free hong kong', 'falun gong', 'falun dafa', 'dalai lama',
]

/** Aimed at the listener (you) by construction: refused wherever they appear. */
const DIRECTED_CJK = ['操你', '艹你', '草你妈', '草泥马', '日你妈', '日你娘', '干你娘', '干你妈', '你妈', '你爹', '你大爷', '去死', '死全家']
const DIRECTED_TOKENS = ['cnm', 'wcnm', 'nmsl', 'nmb', 'rnm', 'nmd', 'nmsb', 'caonima', 'kys', 'stfu']
/** Group slurs and phrases; long enough to match as substrings of the letters. */
const DIRECTED_LETTERS = ['nigger', 'nigga', 'faggot', 'fuckyou', 'fucku', 'caonima']

const FORBIDDEN_CJK = ['强奸', '轮奸', '迷奸', '恋童', '萝莉控']
const FORBIDDEN_TOKENS = ['rape', 'rapist', 'nazi', 'porn', 'pedo']

/** Crude words: fine as a name on their own, not when aimed at someone. */
const CRUDE_CJK = [
  '傻逼', '傻b', '傻比', '傻屄', '傻币', '煞笔', '煞比', '沙比', '傻叉', '傻x', '脑残', '智障', '弱智', '贱人', '贱货', '婊子', '妓女',
  '鸡巴', '屌丝', '屌', '屄', '肏', '王八蛋', '畜生', '杂种', '狗日的', '狗日', '他妈的', '妈逼', '法克',
]
const CRUDE_TOKENS = [
  'sb', 'tmd', 'mlgb', 'sjb', 'shabi', 'fuck', 'fck', 'fuk', 'fvck', 'fucker', 'fucking', 'motherfucker',
  'shit', 'bitch', 'cunt', 'pussy', 'ass', 'asshole', 'whore', 'slut', 'retard',
]

/** The whole name, after an optional "你的/我是你/your" prefix, must equal one of these. */
const CLAIM_EXACT = [
  '爸爸', '爸', '爹', '爹爹', '爹地', '老爹', '爸比', '父亲', '妈妈', '妈', '娘', '老妈', '妈咪', '母亲', '爷爷', '奶奶', '姥姥', '姥爷',
  '外公', '外婆', '义父', '义母', '干爹', '干妈', '祖宗', '大爷', '老子', '老公', '老婆', '亲爱的', '宝贝', '宝宝', '主人', '主子', '老板',
  'dad', 'daddy', 'mom', 'mommy', 'mama', 'papa', 'father', 'mother', 'master', 'husband', 'wife', 'honey', 'baby',
]
const CLAIM_PREFIX = /^(我是你的?|我是|你的?|your|ur|im|iamyour|imyour)/
const RESERVED_EXACT = ['admin', 'administrator', 'root', 'system', 'owner', 'official', 'developer', '管理员', '站长', '系统', '官方', '开发者', '客服']

/** Saying it about oneself is not a target. */
const SELF_PREFIX = /^(我就是|我是|我|本人|俺|咱|iam|im)/
const SELF_SUBJECTS = ['', '我', '本人', '俺', '咱']
/** "<who> 是 <crude>" / "你 <crude>": the words before the crude word that make it aimed at someone. */
const TARGET_LINK = /^(.*?)(你这个|你个|你是|你就是|你真是|你|您|就是|真是|是个|是)$/

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' }

/** undefined = no clear answer, let the model decide. */
export function screenName(name: string, characterName: string): NameScreenResult | undefined {
  const text = name.normalize('NFKC').toLowerCase()
  const leetText = deLeet(text)
  const forms = [squeeze(text), squeeze(leetText)]
  const tokens = new Set([...latinTokens(text), ...latinTokens(leetText)])
  const letters = forms.map(value => value.replace(/[^a-z]/g, ''))
  const hasCjk = (words: string[]) => words.some(word => forms.some(value => value.includes(word)))
  const hasToken = (words: string[]) => words.some(word => tokens.has(word))

  // Political checks use the literal name, not the obfuscation forms used for abuse below.
  // Two-character personal names match only the whole name to avoid swallowing longer ordinary names.
  const politicalText = text.trim()
  const latinText = politicalText.replace(/[\p{Script=Han}\s\p{P}\p{S}]+/gu, ' ')
  if (POLITICAL_CJK.some(word => SHORT_POLITICAL_NAMES.has(word) ? politicalText === word : politicalText.includes(word))
    || POLITICAL_LATIN.some(word => ` ${latinText} `.includes(` ${word} `))) {
    return { allowed: false, reason: POLITICAL }
  }

  if (hasCjk(DIRECTED_CJK) || hasToken(DIRECTED_TOKENS) || DIRECTED_LETTERS.some(word => letters.some(value => value.includes(word)))) {
    return { allowed: false, reason: DIRECTED }
  }
  if (hasCjk(FORBIDDEN_CJK) || hasToken(FORBIDDEN_TOKENS)) return { allowed: false, reason: FORBIDDEN }

  if (forms.some(value => CLAIM_EXACT.includes(value.replace(CLAIM_PREFIX, '')))) return { allowed: false, reason: CLAIM }
  const character = squeeze(characterName.normalize('NFKC').toLowerCase())
  if ([...RESERVED_EXACT, character].some(word => word && forms[0] === word)) return { allowed: false, reason: IMPERSONATE }

  if (!hasCjk(CRUDE_CJK) && !hasToken(CRUDE_TOKENS)) return undefined
  // A crude word on its own, or said of oneself, has no target.
  if (forms.some(value => [...CRUDE_CJK, ...CRUDE_TOKENS].includes(value.replace(SELF_PREFIX, '')))) return { allowed: true }
  if (character && forms[0].includes(character)) return { allowed: false, reason: TARGETED }
  for (const value of forms) {
    for (const word of CRUDE_CJK) {
      const at = value.indexOf(word)
      const link = at > 0 ? value.slice(0, at).match(TARGET_LINK) : null
      if (link && (/^[你您]/.test(link[2]) || !SELF_SUBJECTS.includes(link[1]))) return { allowed: false, reason: TARGETED }
    }
  }
  return undefined
}

/**
 * "sh1t", "b1tch" → "shit", "bitch". Only runs with at least two letters and a
 * look-alike digit are rewritten, so "58" or a model name like "S8" stay as they are.
 */
function deLeet(value: string) {
  return value.replace(/[a-z0-9@$]+/g, run => /[a-z].*[a-z]/.test(run) && /[0134578@$]/.test(run) ? run.replace(/[0134578@$]/g, char => LEET[char]) : run)
}

/** Letters and digits only: drops spaces, dots and other separators used to dodge a match. */
function squeeze(value: string) { return value.replace(/[^\p{L}\p{N}]/gu, '') }

/**
 * Runs of Latin letters, split on anything else (digits, CJK, symbols). Runs of
 * single letters are also joined, so "s b" and "S.B." count as "sb".
 */
function latinTokens(value: string) {
  const parts = value.split(/[^a-z]+/).filter(Boolean)
  const tokens = [...parts]
  let run = ''
  for (const part of [...parts, '']) {
    if (part.length === 1) { run += part; continue }
    if (run.length > 1) tokens.push(run)
    run = ''
  }
  return tokens
}
