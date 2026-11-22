const localization = require('../../shared/addon-localization');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { compareThemeVersions: compareVersions } = require('../theme-versions');
const { httpsUrl } = require('./network');
const permissions = require('../../shared/addon-permissions');
const settings = require('../../shared/addon-settings');
const assets = require('../../shared/addon-assets');
const MAX_BYTES = 16 * 1024 * 1024;
const PERMISSIONS = [...Object.keys(permissions.labels), ...permissions.groups];
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(value) && !['constructor','prototype'].includes(value);
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value) && compareVersions(value, value) === 0;
const text = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail((globalThis.noctuneI18n?.t("extensions.package.unknownExtensionPackageField", {}) ?? "Неизвестное поле пакета расширения"));
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function unsigned(value) { const { signature, ...payload } = value; return payload; }
function signingIdentity(value, required = false) {
  if (!value.signature) { if (required) fail((globalThis.noctuneI18n?.t("extensions.package.packageOrUpdateMetadataMustBeSigned", {}) ?? "Пакет или сведения об обновлении должны быть подписаны")); return null; }
  keys(value.signature, ['algorithm', 'publicKey', 'value']);
  const s = value.signature;
  if (s.algorithm !== 'Ed25519' || !text(s.publicKey, 128) || !text(s.value, 128)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidSignature", {}) ?? "Некорректная подпись"));
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(s.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.from(canonical(unsigned(value))), key, Buffer.from(s.value, 'base64'))) fail((globalThis.noctuneI18n?.t("extensions.package.signatureDoesNotMatchContent", {}) ?? "Подпись не соответствует содержимому"));
    return crypto.createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex');
  } catch (_) { fail((globalThis.noctuneI18n?.t("extensions.package.couldNotVerifyExtensionSignature", {}) ?? "Не удалось проверить подпись расширения")); }
}
function sign(value, privateKey) {
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') fail((globalThis.noctuneI18n?.t("extensions.package.ed25519KeyRequired", {}) ?? "Нужен ключ Ed25519"));
  return { ...unsigned(value), signature: { algorithm: 'Ed25519', publicKey: crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64'), value: crypto.sign(null, Buffer.from(canonical(unsigned(value))), key).toString('base64') } };
}
function validatePackage(value) {
  if (Buffer.byteLength(JSON.stringify(value) || '') > MAX_BYTES) fail((globalThis.noctuneI18n?.t("extensions.package.extensionExceeds16Mb", {}) ?? "Расширение превышает 16 МБ"));
  keys(value, ['format', 'formatVersion', 'manifest', 'files', 'signature']);
  if (value.format !== 'noctune-addon' || value.formatVersion !== 1) fail((globalThis.noctuneI18n?.t("extensions.package.unsupportedExtensionFormat", {}) ?? "Не поддерживается формат расширения"));
  const m = value.manifest;
  keys(m, ['id','name','description','author','version','revision','apiVersion','minNoctuneVersion','maxNoctuneVersion','type','entry','permissions','network','commands','update','homepage','settings','oauth','icon','banner','ui','credentials','localization']);
  if (!id(m.id) || !text(m.name) || !text(m.description, 1200) || !text(m.author)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidExtensionDescription", {}) ?? "Некорректное описание расширения"));
  if (!version(m.version) || !Number.isSafeInteger(m.revision) || m.revision < 1) fail((globalThis.noctuneI18n?.t("extensions.package.versionXYZAndAPositiveRevisionAreRequired", {}) ?? "Нужны версия x.y.z и положительная ревизия"));
  if (![1, 2].includes(m.apiVersion)) fail((globalThis.noctuneI18n?.t("extensions.package.extensionApis1And2AreSupported", {}) ?? "Поддерживаются API расширений 1 и 2"));
  if (!version(m.minNoctuneVersion) || (m.maxNoctuneVersion !== undefined && (!version(m.maxNoctuneVersion) || compareVersions(m.maxNoctuneVersion, m.minNoctuneVersion) < 0))) fail((globalThis.noctuneI18n?.t("extensions.package.invalidNoctuneCompatibility", {}) ?? "Некорректная совместимость с Noctune"));
  if (!['extension','integration'].includes(m.type)) fail((globalThis.noctuneI18n?.t("extensions.package.unknownExtensionType", {}) ?? "Неизвестный тип расширения"));
  if (m.homepage !== undefined) httpsUrl(m.homepage);
  if (!Array.isArray(m.permissions) || m.permissions.some(p => !PERMISSIONS.includes(p)) || new Set(m.permissions).size !== m.permissions.length) fail((globalThis.noctuneI18n?.t("extensions.package.unknownOrDuplicatePermission", {}) ?? "Неизвестное или повторяющееся разрешение"));
  if (m.localization !== undefined && m.apiVersion !== 2) fail((globalThis.noctuneI18n?.t("language.errors.localizationRequiresExtensionApi2") ?? "Localization requires extension API 2"));
  if (m.permissions.some(permission => ['i18n.register', 'i18n.*'].includes(permission)) && m.apiVersion !== 2) fail((globalThis.noctuneI18n?.t("language.errors.languagePacksRequireExtensionApi2") ?? "Language packs require extension API 2"));
  localization.validate(localization.resolve(m.localization, value.files));
  const grants = permissions.expand(m.permissions);
  if (grants.includes('network.request')) {
    keys(m.network, ['origins','routes']);
    if (!Array.isArray(m.network.origins) || !m.network.origins.length || m.network.origins.length > 8 || new Set(m.network.origins).size !== m.network.origins.length) fail((globalThis.noctuneI18n?.t("extensions.package.declareUpToEightHttpsDomains", {}) ?? "Укажите до восьми HTTPS-доменов"));
    for (const origin of m.network.origins) if (!require('../../shared/addon-contributions').validOrigin(origin)) fail((globalThis.noctuneI18n?.t("extensions.package.networkOriginsRequiresAnExactHttpsOriginOrHttpsExampleCom", {}) ?? "В network.origins нужен точный HTTPS-origin или https://*.example.com"));
    if (m.network.origins.some(origin => origin.includes('*')) && compareVersions(m.minNoctuneVersion, '1.4.0') < 0) fail((globalThis.noctuneI18n?.t("extensions.package.subdomainsRequireMinnoctuneversion140OrLater", {}) ?? "Поддомены требуют minNoctuneVersion 1.4.0 или новее"));
  } else if (m.network !== undefined) fail((globalThis.noctuneI18n?.t("extensions.package.domainsRequireNetworkPermission", {}) ?? "Домены требуют разрешения network"));
  if (m.settings !== undefined) settings.validate(m.settings);
  if (Object.values(m.settings || {}).some(field => field.type === 'directory') && !grants.includes('downloads.write')) fail((globalThis.noctuneI18n?.t("downloads.errors.permissionRequired") ?? "Настройке папки нужно разрешение downloads.write"));
  require('../../shared/addon-contributions').validate(m, grants);
  if (m.oauth !== undefined) {
    if (!object(m.oauth) || Object.keys(m.oauth).length > 8) fail((globalThis.noctuneI18n?.t("extensions.package.invalidOauthProviders", {}) ?? "Некорректные провайдеры OAuth"));
    for (const [name, config] of Object.entries(m.oauth)) {
      if (!id(name)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidOauthId", {}) ?? "Некорректный ID OAuth"));
      keys(config, ['name','flow','clientId','authorizationUrl','tokenUrl','deviceAuthorizationUrl','scopes','resourceOrigins','redirectPort','extraParams']);
      if (!text(config.name) || !text(config.clientId, 300) || !['authorization_code','device_code'].includes(config.flow)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidOauthClient", {}) ?? "Некорректный OAuth-клиент"));
      httpsUrl(config.tokenUrl);
      httpsUrl(config.flow === 'authorization_code' ? config.authorizationUrl : config.deviceAuthorizationUrl);
      if (!Array.isArray(config.scopes) || config.scopes.length > 32 || !config.scopes.every(s => typeof s === 'string' && /^[\x21\x23-\x5b\x5d-\x7e]{1,120}$/.test(s))) fail((globalThis.noctuneI18n?.t("extensions.package.invalidOauthScopes", {}) ?? "Некорректные OAuth scopes"));
      if (!Array.isArray(config.resourceOrigins) || config.resourceOrigins.length > 8 || !config.resourceOrigins.every(origin => require('../../shared/addon-contributions').validOrigin(origin, false) && m.network?.origins.includes(origin))) fail((globalThis.noctuneI18n?.t("extensions.package.oauthResourceoriginsMustBeExactOriginsInNetworkOrigins", {}) ?? "OAuth resourceOrigins должны быть точными origin в network.origins"));
      if (config.redirectPort !== undefined && (!Number.isInteger(config.redirectPort) || config.redirectPort < 1024 || config.redirectPort > 65535)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidOauthCallbackPort", {}) ?? "Некорректный порт OAuth callback"));
      if (config.extraParams !== undefined && (!object(config.extraParams) || Object.keys(config.extraParams).length > 12 || Object.entries(config.extraParams).some(([k,v]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(k) || ['state','client_id','redirect_uri','response_type','code_challenge','code_challenge_method','scope'].includes(k) || typeof v !== 'string' || v.length > 300))) fail((globalThis.noctuneI18n?.t("extensions.package.invalidOauthParameters", {}) ?? "Некорректные параметры OAuth"));
    }
  }
  if (!Array.isArray(m.commands) || m.commands.length > 12) fail((globalThis.noctuneI18n?.t("extensions.package.invalidCommandList", {}) ?? "Некорректный список команд"));
  for (const c of m.commands) { keys(c, ['id','title']); if (!id(c.id) || !text(c.title, 80)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidCommand", {}) ?? "Некорректная команда")); }
  if (new Set(m.commands.map(c => c.id)).size !== m.commands.length) fail((globalThis.noctuneI18n?.t("extensions.package.duplicateCommandIds", {}) ?? "ID команд повторяются"));
  if (m.update !== undefined) { keys(m.update, ['url','channel']); httpsUrl(m.update.url); if (m.update.channel !== 'stable') fail((globalThis.noctuneI18n?.t("extensions.package.theStableChannelIsSupported", {}) ?? "Поддерживается канал stable")); }
  if (!object(value.files) || !Object.keys(value.files).length || Object.keys(value.files).length > 32) fail((globalThis.noctuneI18n?.t("extensions.package.packageMustContainBetween1And32Files", {}) ?? "В пакете должно быть от 1 до 32 файлов"));
  for (const [file, contents] of Object.entries(value.files)) {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/.test(file)) fail((globalThis.noctuneI18n?.t("extensions.package.invalidAssetPath", {}) ?? "Недопустимый путь ресурса"));
    if (/\.(js|json|md|txt)$/.test(file)) {
      if (typeof contents !== 'string' || Buffer.byteLength(contents) > 512 * 1024) fail((globalThis.noctuneI18n?.t("extensions.package.textFileExceeds512KbOrHasAnInvalidFormat", {}) ?? "Текстовый файл превышает 512 КБ или имеет некорректный формат"));
    } else {
      if (!assets.mime(file)) fail((globalThis.noctuneI18n?.t("extensions.package.unknownBinaryAssetFormat", {}) ?? "Неизвестный двоичный формат ресурса"));
      keys(contents, ['encoding','data']);
      if (contents.encoding !== 'base64' || typeof contents.data !== 'string' || !contents.data.length || contents.data.length > Math.ceil(2 * 1024 * 1024 / 3) * 4 || /[^A-Za-z0-9+/=]/.test(contents.data) || contents.data.length % 4 !== 0) fail((globalThis.noctuneI18n?.t("extensions.package.invalidAssetBase64", {}) ?? "Некорректный base64 ресурса"));
      const bytes = Buffer.from(contents.data, 'base64');
      if (bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== contents.data) fail((globalThis.noctuneI18n?.t("extensions.package.binaryAssetExceeds2MbOrIsCorrupted", {}) ?? "Двоичный ресурс превышает 2 МБ или повреждён"));
    }
  }
  for (const field of ['icon','banner']) if (m[field] !== undefined) {
    if (typeof m[field] !== 'string' || !assets.mime(m[field])?.startsWith('image/') || !Object.hasOwn(value.files, m[field])) fail(field + (globalThis.noctuneI18n?.t("extensions.package.mustReferenceAnImageInThePackage", {}) ?? " должен указывать на изображение в пакете"));
  }
  if (typeof m.entry !== 'string' || !m.entry.endsWith('.js') || typeof value.files[m.entry] !== 'string') fail((globalThis.noctuneI18n?.t("extensions.package.entryJsFileNotFound", {}) ?? "Не найден входной JS-файл"));
  signingIdentity(value);
  return value;
}
function compatible(m, appVersion) {
  return compareVersions(appVersion, m.minNoctuneVersion) >= 0 && (!m.maxNoctuneVersion || compareVersions(appVersion, m.maxNoctuneVersion) <= 0);
}
async function readPackage(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) fail((globalThis.noctuneI18n?.t("extensions.package.extensionExceeds16Mb", {}) ?? "Расширение превышает 16 МБ"));
  return validatePackage(JSON.parse(await fs.readFile(file, 'utf8')));
}
async function packDirectory(directory) {
  const root = await fs.realpath(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const files = {}; let total = 0;
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail((globalThis.noctuneI18n?.t("extensions.package.symlinksAreNotSupportedInExtensions", {}) ?? "Символические ссылки в расширениях не поддерживаются"));
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (path.relative(root, file).split(path.sep).length > 4) fail((globalThis.noctuneI18n?.t("extensions.package.directoryNestingTooDeep", {}) ?? "Слишком большая вложенность")); await walk(file); }
      else if (entry.isFile() && file !== path.join(root, 'manifest.json')) {
        if (++total > 32 || (await fs.stat(file)).size > (assets.mime(file) ? 2 * 1024 * 1024 : 512 * 1024)) fail((globalThis.noctuneI18n?.t("extensions.package.tooManyFilesOrFileTooLarge", {}) ?? "Слишком много файлов или слишком большой файл"));
        const relative = path.relative(root, file).split(path.sep).join('/');
        files[relative] = assets.mime(relative) ? { encoding: 'base64', data: (await fs.readFile(file)).toString('base64') } : await fs.readFile(file, 'utf8');
      }
    }
  }
  await walk(root);
  return validatePackage({ format: 'noctune-addon', formatVersion: 1, manifest, files });
}
module.exports = { MAX_BYTES, PERMISSIONS, canonical, sign, signingIdentity, validatePackage, compatible, readPackage, packDirectory, compareVersions, id, keys, version };
