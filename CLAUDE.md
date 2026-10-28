# Цайны цаг: ажлын тэмдэглэл (Claude сешнд зориулав)

Энэ файл л байхад өөр компьютер дээрх шинэ Claude сешн ажлыг үргэлжлүүлж чадна. Repo-г ZIP-ээр татаж задлаад эндээс эхэл.

## ⚠ Хамгийн чухал дүрэм

- **Repo PUBLIC.** Ажлын мэдээлэл огт оруулахгүй: худалдан авалтын жагсаалт, WO, засварчин, жолоочийн нэр, Excel-ийн агуулга гэх мэт.
- Компанийн нэр, хэрэглэгчийн компьютерийн дотоод зам (хэрэглэгчийн хавтас, sync хийдэг хавтасны нэр), Claude-ийн session ID-г repo-д бичихгүй.
- Сервер дээр зөвхөн тоглогчийн нэр (24 тэмдэгт хүртэл), оноо, тоглоомын өрөө, өөрсдийн бичсэн сорилын асуулт л хадгалагдана.
- `firebase-config.js` доторх web config (apiKey г.м.) нууц биш, public байж болно. Хамгаалалт нь `src/firebase-rules.json`-д байгаа.

## Зорилго

Хамт олны завсарлагад утас, notebook дээр тоглох богино тоглоомууд. Ганцаараа дээд амжилтаа ахиулах, эсвэл багаараа нэг дор өрсөлдөх зорилготой.

| Түлхүүр | Нэр | Хуудас | Товч |
|---|---|---|---|
| `flappy` | Болжмор | `bolzhmor.html` | Хадны завсраар нисэх (canvas). Оноо их нь сайн. |
| `race` | Карьерын зам | `karier.html` | 3 эгнээтэй зам, HOWO машинаар чулуу, БелАЗ-аас зайлсхийнэ. Шатахуун +50 м. Зай их нь сайн. |
| `puzzle` | Таавар 3×3 | `taavar.html` | 8-ын таавар. Хугацаа бага нь сайн. |
| `quiz` | Мэдлэгийн сорил | `soril.html` | 10 асуулт × 15 сек, асуулт бүрт 500–1000 оноо. Асуултууд код доторх `BANK`-д бий (~50 ширхэг). |
| `live` | Хамтдаа сорил | (цэснээс) | Бүгд нэг асуултыг зэрэг авна. Өөрийн асуултын багц үүсгэж болно (асуулт + 2–4 хариулт, зөвийг нь дугуйлна). |
| `chess` | Шатар | `shatar.html` | Өөрийн дүрмийн хөдөлгүүр, компьютер 3 түвшинтэй (Амархан/Дунд/Хүнд → ялбал 1/3/5 оноо, нийлбэрээр самбарт). Хоёулаа нэг дэлгэц дээр, онлайн, тойргийн тэмцээн. |
| — | Өрөө | (цэс дээрх хэсэг) | Кодтой өрөө (4–6 тэмдэгт) нээнэ. Өрөөнд хэн байгаа нь харагдана. Өрөө нээсэн хүн тоглоом, хугацаа (3–30 мин) сонгож тэмцээн эхлүүлнэ. Тэр хугацааны шилдэг оноо ялна. Өрөөн доторх «Хамтдаа сорил», шатар зөвхөн тухайн өрөөнийхөнд нээгдэнэ. |

URL-ийн hash: `#flappy`, `#race`, `#puzzle`, `#quiz`, `#live`, `#chess` тоглоомыг шууд нээнэ. `#r=КОД` өрөөнд оруулна.

## Файлын бүтэц

```
/ (repo root = GitHub Pages сайт)
  index.html, bolzhmor.html, karier.html, taavar.html, soril.html, shatar.html   ← build-ээр үүснэ, гараар бүү засаарай
  app.css, app.js                                                               ← build-ээр үүснэ
  firebase-config.js      ← гараар засна: window.FIREBASE_CONFIG = {…} эсвэл null
  README.md               ← тоглогчдод зориулсан товч тайлбар
  CLAUDE.md               ← энэ файл
  src/
    tsainy-tsag.html      ← ЦОРЫН ГАНЦ эх код (Claude Artifact-ийн эх хуудас, <head>-гүй нэг файл)
    build.ps1             ← эх кодоос сайтын файлуудыг үүсгэнэ
    firebase-rules.json   ← Firebase Realtime Database-ийн rules
```

## Build

Windows PowerShell 5.1 хангалттай. Node, Python, git шаардлагагүй.

```
powershell -ExecutionPolicy Bypass -File src\build.ps1
```

- Бүх зам скриптийн байрлалаас харьцангуй тул repo аль ч хавтсанд байсан ажиллана.
- Скрипт `src/tsainy-tsag.html`-аас `<link>`, `<style>`, markup, `<script>`-ийг салгаж `app.css`, `app.js`, 6 хуудас (`data-start` атрибуттай) үүсгэнэ.
- Хуудас бүр `firebase-config.js`, дараа нь `app.js`-ийг ачаална.
- Төгсгөлд нь «GitHub руу дахин upload хийх: …» гэж өөрчлөгдсөн файлуудыг хэвлэнэ. Энэ жагсаалтыг хэрэглэгчид өгнө.
- `firebase-config.js`-ийг зөвхөн байхгүй үед `null`-тай stub болгон үүсгэнэ. Байгаа бол дарж бичихгүй.
- `src/tsainy-tsag.html` нь `<head>`-гүй тул CSS, JS бүр өөрийн `<style>`, `<script>` блок дотор байна. Шинэ CSS, JS-ийг тэдгээр блок дотор нэм.

## Гурван ажиллах горим (нэг код)

`app.js`-ийн эхэнд backend сонгогдоно:

1. **Claude Artifact.** `window.claude.use` байвал Artifact-ийн capability-уудыг ашиглана: `db` (хадгалалт), `room` (яг одоо нээлттэй хүмүүс), `user` (нэр, profile).
   - Линк: https://claude.ai/artifact/VB9Ch58qfdDhDeYnjDU3cM
   - Багийнхан claude.ai бүртгэлээр орно. Бичих эрхэд Share цэснээс **Contributor** эрх хэрэгтэй.
2. **GitHub Pages + Firebase.** `window.FIREBASE_CONFIG` нь apiKey, databaseURL-тай бол Firebase-ийн adapter-ууд (`fbDb`, `fbRoom`, `fbUser`) яг ижил хэлбэрийг гаргаж өгнө. Ингэснээр бусад код өөрчлөгдөхгүй.
   - Анх нээхэд нэр асууна (`localStorage` `tsai:nick`).
   - Firebase Anonymous Auth чимээгүй нэвтэрнэ. Хэрэглэгч нэвтрэх товч хэзээ ч харахгүй.
3. **Офлайн.** Config байхгүй бол ганцаараа тоглоно, амжилт төхөөрөмж дээр хадгалагдана.

Artifact-ийг шинэчлэх (Artifact tool, тухайн claude.ai бүртгэлээр):
- `file_path` = `src/tsainy-tsag.html`, `url` = дээрх Artifact линк (өөр URL үүсгэхгүйн тулд заавал).
- Capabilities-ийг өөрчлөх бол бүгдийг нь дахин зааж өгнө: `db.rules` = `scores` (read view / write owner), `scores/{self}` (read view / write interact), `quizsets` (view / owner), `quizsets/{self}` (view / interact), `tours` (view / interact), `arena` (view / interact); `user` = `{scopes:["profile"]}`; `room` = `{}`.
- Capabilities-ийг орхивол хуучин хэвээр үлдэнэ.

## Өгөгдлийн бүтэц

Artifact `db` болон Firebase RTDB хоёуланд ижил замтай. RTDB дээр doc-ийн `set` нь `update` (merge) байдлаар ажилладаг тул доорх дэд цуглуулгууд арилахгүй.

| Зам | Агуулга | Хэн бичнэ |
|---|---|---|
| `scores/<uid>` | `{flappy:{best,at}, race…, puzzle…, quiz…, chess…}`. Шатрынх нь нийлбэр оноо. | тухайн хүн |
| `names/<uid>` | нэр (зөвхөн Firebase) | тухайн хүн |
| `quizsets/<uid>/sets/<id>` | `{title, sec (10/15/20/30), qs:[{q, o:[2–4], k}], at}` | тухайн хүн |
| `tours/<id>` | шатрын тэмцээн `{name, by, status: join/play/done, order:[uid], at, started, ended}` | зохион байгуулагч |
| `tours/<id>/players/<uid>` | `{at}` (бүртгэл) | тухайн хүн, `join` үед |
| `tours/<id>/games/p<i>-<j>` | `{w, b, res: w/b/d, how: online/board, by, at, n}` | тухайн хосын тоглогч эсвэл зохион байгуулагч |
| `arena/<CODE>` | өрөө `{by, game, mins, round, start, ends, at}` | өрөө нээсэн хүн |
| `arena/<CODE>/scores/<uid>` | `{best, at, round}` (зөвхөн тухайн тойрог, `ends`-ээс өмнө) | тухайн хүн |
| `rooms/<нэр>/<холболт>` | `{by, at, p: JSON presence}`. Зөвхөн Firebase. Хуудас хаагдахад устна. | тухайн хүн |

Room-ийн нэрс: `lobby`, `quiz`, `chess`. Өрөөнд байх үед `quiz-<код>`, `chess-<код>`, `arena-<код>` болно.

Онлайн шатрын бүх төлөв presence-д явна: `{inv, g:{id, w, b, mv:"e2e4 e7e5 …", tour, pair, end, draw}}`. Хоёр тоглогч бүтэн нүүдлийн жагсаалтаа тусгаж байршуулдаг. Өрсөлдөгчийн жагсаалт нэг нүүдлээр урт болж, тэр нүүдэл нь дүрмийн дагуу байвал хүлээж авна.

## Firebase

- Бүтээгдэхүүн: **Realtime Database**, бүс `asia-southeast1`. Locked mode-оор үүсгээд `src/firebase-rules.json`-ийг Rules таб дээр бүтнээр нь буулгаж Publish хийнэ.
- **Authentication → Anonymous** асаалттай байх ёстой.
- SDK: `https://www.gstatic.com/firebasejs/10.12.2/firebase-{app,auth,database}.js`. Зөвхөн Firebase горимд dynamic `import()`-оор ачаална. Artifact-д ачаалагдахгүй.
- Rules-ийн гол санаа:
  - бүх уншилт `auth != null`;
  - хүн бүр зөвхөн `auth.uid`-тай өөрийн node-доо бичнэ;
  - талбар бүрийн төрөл, уртад хязгаар тавьсан, мэдэгдэхгүй талбар (`$other`) хориотой;
  - өрөөний оноо зөвхөн тухайн тойрогт, `ends`-ээс өмнө бичигдэнэ;
  - presence 4096 тэмдэгт хүртэл.
- Config авах: Project settings → Your apps → Web app → `firebaseConfig`. `databaseURL` заавал байх ёстой. Түүнийг `firebase-config.js`-д `window.FIREBASE_CONFIG = {…};` хэлбэрээр бичнэ.

## GitHub руу upload хийх (git ашиглахгүй, браузераар)

1. Repo дээр **Add file → Upload files** дарна.
2. Build-ийн хэвлэсэн файлуудыг чирж оруулна. `src/` доторх файл бол `src` хавтсыг бүхэлд нь чирнэ, бүтэц нь хадгалагдана.
3. **Commit changes** дарна. Ижил нэртэй файл солигдоно.
4. Pages: Settings → Pages → Deploy from a branch → `main` / `(root)`. Сайт `https://<хэрэглэгч>.github.io/togloom/` хаягаар нээгдэнэ.

## Туршилт (Claude-ийн Browser pane)

- Pane нь `file://`-ийг `data:` URL болгож үзүүлдэг. Тиймээс харьцангуй `app.css`, `app.js` ачаалагдахгүй, `localStorage` алдаа өгнө.
- Туршихын тулд CSS, JS-ийг шингээсэн түр хуудсыг **repo-гийн хавтас дотор** үүсгэ. Гадна байвал хөдөлгөөнгүй зураг болно. Туршсаны дараа заавал устга, upload хийхгүй.
- Багийн боломжуудыг дуурайлгах: хуудасны өмнө хуурамч `window.claude` (санах ойн db/room/user), эсвэл `window.FIREBASE_CONFIG` + `import()`-ийг санах ойн Firebase модулиар солино.
- Шатрын дүрмийн шалгалт (perft) дараах тоонуудтай таарах ёстой:
  - эхлэл d3 = 8902;
  - Kiwipete d2 = 2039, d3 = 97862;
  - pos3 d4 = 43238;
  - pos4 d3 = 9467;
  - pos5 d3 = 62379.

## Сешнүүдийн хуваарь

- **Тоглоом Admin:** хэрэглэгчийн хүсэлтийг хүлээж аваад хуваарилна, Notion-д тэмдэглэнэ.
- **Тоглоом хөгжүүлэлт:** бүх код. Үүнд `src/`, build, Artifact, Firebase-тэй ажиллах код, rules орно. Build-ийн дараа upload хийх файлын жагсаалтыг түгээлт рүү явуулна.
- **Тоглоом түгээлт:** хэрэглэгчийг GitHub repo, upload, Pages, Firebase console (төсөл, Anonymous auth, rules Publish, config авах) дээр хөтөлнө. Ажиллаж буй сайтыг шалгана, багт илгээх текстийг бэлдэнэ. Config-ийг хөгжүүлэлт рүү дамжуулна.

## Дараагийн санаа (хийгдээгүй)

Долоо хоногийн аварга, шатрын цаг, хасагдах системтэй тэмцээн.

Firebase горимыг жинхэнэ сервер дээр, мөн онлайн шатар, өрөөг олон хүнтэй туршсан эсэхийг хэрэглэгчээс асууж шалгаарай.
