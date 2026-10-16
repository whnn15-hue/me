/** Static preview, with an opaque origin and no scripts, forms or remote resources. */
export function staticHtmlPreview(source: string) {
  if (source.length > 2 * 1024 * 1024) throw new Error("큰 HTML 파일은 드라이브에서 원본으로 열어 주세요. 미리보기는 2 MB까지 지원합니다.");
  // Template parsing is inert: images and other resources cannot start loading.
  const template = document.createElement("template");
  template.innerHTML = source;
  const allowed = new Set("a abbr article aside b bdi bdo blockquote br caption code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q s samp section small span strong style sub summary sup table tbody td th thead time tr u ul var wbr".split(" "));
  const discard = new Set("script iframe frame frameset object embed link base meta template noscript svg math title form input button textarea select".split(" "));
  const attributes = new Set("id class title dir lang style width height colspan rowspan alt align aria-label".split(" "));
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    const tag = element.localName.toLowerCase();
    if (discard.has(tag)) { element.remove(); continue; }
    if (!allowed.has(tag)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of Array.from(element.attributes)) {
      if (attributes.has(attribute.name.toLowerCase())) continue;
      if (tag === "img" && attribute.name === "src" && /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(attribute.value)) continue;
      element.removeAttribute(attribute.name);
    }
  }
  const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{color-scheme:light}body{margin:24px;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body>${template.innerHTML}</body></html>`;
}
