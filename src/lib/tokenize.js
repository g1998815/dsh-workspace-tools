// src/lib/tokenize.js —— 极简语法高亮 token 化（字符串/注释/关键字/数字）
const KEYWORDS = {
  js: new Set(["const","let","var","function","return","if","else","for","while","class","import","export","from","new","this","async","await","try","catch","throw","switch","case","break","continue","typeof","instanceof","extends","super","static","get","set","null","undefined","true","false"]),
  java: new Set(["public","private","protected","class","interface","extends","implements","return","if","else","for","while","new","this","static","final","void","int","long","double","boolean","String","try","catch","throw","import","package","null","true","false"]),
  py: new Set(["def","class","return","if","elif","else","for","while","import","from","as","with","try","except","finally","lambda","pass","break","continue","None","True","False","self","global","nonlocal","yield","raise","in","is","not","and","or"]),
};
export function tokenize(text, ext) {
  const lang = ext === "py" ? "py" : ext === "java" ? "java" : ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx" ? "js" : null;
  const kws = lang ? KEYWORDS[lang] : null;
  const out = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|#[^\n]*|<!--[\s\S]*?-->|\b\d+(?:\.\d+)?\b|[A-Za-z_$][A-Za-z0-9_$]*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), cls: null });
    const tok = m[0];
    let cls = null;
    if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) cls = "str";
    else if (tok.startsWith("//") || tok.startsWith("#") || tok.startsWith("<!--")) cls = "com";
    else if (/^\d/.test(tok)) cls = "num";
    else if (kws && kws.has(tok)) cls = "kw";
    out.push({ text: tok, cls });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: null });
  return out;
}
