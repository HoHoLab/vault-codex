import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import ru from './locales/ru.json';
import pt from './locales/pt.json';

export const LOCALES = {en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', ja: '日本語', ko: '한국어', de: 'Deutsch', fr: 'Français', es: 'Español', ru: 'Русский', pt: 'Português'} as const;
export type Locale = keyof typeof LOCALES;
export type Language = Locale | 'auto';
export type Translate = (key: string, params?: Record<string, string | number>) => string;
export const dictionaries: Record<Locale, Record<string, string>> = {en, 'zh-CN': zhCN, 'zh-TW': zhTW, ja, ko, de, fr, es, ru, pt};

export function resolveLocale(language: string): Locale {
  const tag = language.replace(/_/g, '-').toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-')) return /(?:tw|hk|mo|hant)/.test(tag) ? 'zh-TW' : 'zh-CN';
  const base = tag.split('-')[0];
  return Object.hasOwn(LOCALES, base) ? base as Locale : 'en';
}

export class I18n {
  constructor(private language: () => Language = () => 'zh-CN', private hostLanguage: () => string = () => 'en') {}
  get locale(): Locale {const selected = this.language(); return resolveLocale(selected === 'auto' ? this.hostLanguage() : selected);}
  readonly t: Translate = (key, params = {}) => {
    const text = dictionaries[this.locale][key] ?? dictionaries.en[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] === undefined ? match : String(params[name]));
  };
}

// Non-UI helpers keep their historic default; each plugin supplies its own
// translator, so different vaults never share a mutable global language.
export const defaultTranslate: Translate = (key, params = {}) => key.replace(/\{(\w+)\}/g, (match, name: string) => params[name] === undefined ? match : String(params[name]));

/** Bind the initial static shell once. Chat messages and user input are never scanned. */
export function bindStaticTranslations(root: HTMLElement, t: Translate): () => void {
  const texts: {node: Text; key: string}[] = [];
  const attributes: {el: Element; name: string; key: string}[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const key = node.textContent ?? '';
    if (Object.hasOwn(dictionaries.en, key)) texts.push({node: node as Text, key});
  }
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const name of ['placeholder', 'aria-label', 'title']) {
      const key = el.getAttribute(name);
      if (key && Object.hasOwn(dictionaries.en, key)) attributes.push({el, name, key});
    }
  }
  return () => {
    for (const {node, key} of texts) node.textContent = t(key);
    for (const {el, name, key} of attributes) el.setAttribute(name, t(key));
  };
}
