# Source comment inventory

Locations refer to the working tree immediately before cleanup. A range groups consecutive comment lines. Numbers in parentheses refer to the [maintenance issues](comment-issues.md). The inventory covers repository-owned JavaScript, Swift, CSS, HTML and SVG, including tests and build scripts. Generated bundles, third-party notices, and build outputs are outside the count.

The audit removed 1,515 comment tokens and 1,718 physical source lines. It classified 381 tokens as tautologies, 21 as stale, 7 as excuses and 1,106 as decision records. A block comment counts once regardless of length. Consecutive line comments count individually. Inline comments can disappear without shortening the file by a line.

### chrome-extension/activity.js

- [Decision record](adr/capture.md) — 1–3, 56–57, 88–89
- Stale — 46–47

### chrome-extension/capture-core.js

- Tautology — 23

### chrome-extension/collector.css

- [Decision record](adr/capture.md) — 1–3, 20, 26–27

### chrome-extension/instagram-media.js

- Tautology — 1

### chrome-extension/popup.css

- [Decision record](adr/capture.md) — 1–4
- Tautology — 10, 24, 114, 198, 252, 340, 397, 414, 443, 591

### chrome-extension/popup.js

- [Decision record](adr/capture.md) — 8–9, 21–22, 241–242, 273–275

### chrome-extension/quick-save.js

- [Decision record](adr/capture.md) — 4–7, 11–12, 18, 24–25, 92–94, 128–130, 150–151, 168–169, 190, 207–209, 285–286, 293–295, 301–303, 329–330, 335, 356–357, 367–369, 388–389
- Tautology — 34, 231, 311, 347, 349, 363, 373, 393

### chrome-extension/social-core.js

- [Decision record](adr/capture.md) — 28–29, 77–80, 105–107, 122, 153, 179, 265
- Tautology — 34, 134

### chrome-extension/worker.js

- [Decision record](adr/capture.md) — 11–12, 24–26, 28, 31–33, 169–178, 196–199, 223–224, 228, 258, 319

### electron/bookmark-types.cjs

- [Decision record](adr/library.md) — 1–3

### electron/bookmarks.cjs

- [Decision record](adr/library.md) — 7–9, 241–242

### electron/browser-fetch.cjs

- [Decision record](adr/desktop.md) — 5–12, 43–44, 52–53, 61–64

### electron/capture-bridge.cjs

- [Decision record](adr/desktop.md) — 9–12, 73–74, 81

### electron/deletion.cjs

- [Decision record](adr/library.md) — 10–11

### electron/extension-setup.cjs

- [Decision record](adr/desktop.md) — 50

### electron/import-queue.cjs

- [Decision record](adr/library.md) — 15–18

### electron/import-recovery.cjs

- [Decision record](adr/library.md) — 32, 36

### electron/library.cjs

- [Decision record](adr/library.md) — 23–25, 27–29, 33–35, 37–38, 42–43, 53–55, 68–69, 78–79, 82–84, 104–106, 173–176, 203, 211–212, 217–219, 235, 238, 243, 270–271, 335–336, 350–351
- Tautology — 315–316

### electron/local-model.cjs

- [Decision record](adr/library.md) — 3–7
- Tautology — 13, 29

### electron/main.cjs

- [Decision record](adr/desktop.md) — 60–62, 155, 166, 229, 255–256, 326–327, 341–343, 348–349, 374–375, 383–385, 402–403, 416–419, 430, 442–443, 451–453, 462–464, 476–479, 489–490, 509–510, 539–542, 557–558, 570–571, 578–580, 595–596, 689–692, 700–701, 716–717, 728–729, 840–842, 861–863, 930, 961–963, 970–974, 982–983, 1009, 1058–1060, 1079–1081, 1120–1121
- Tautology — 299, 589

### electron/native-host.cjs

- [Decision record](adr/desktop.md) — 1

### electron/originals-watch.cjs

- [Decision record](adr/library.md) — 6–9, 23, 32, 51–58, 86–87, 93, 94
- Tautology — 102

### electron/perceptual-hash.cjs

- [Decision record](adr/library.md) — 1–12, 16–17, 20–22, 27–29, 70–73

### electron/public-fetch.cjs

- [Decision record](adr/desktop.md) — 37–39, 54

### electron/smart-index.cjs

- [Decision record](adr/library.md) — 5–7, 10–11, 15–16, 51, 57–58, 72–74, 122–124, 131, 256–259, 281, 291–293, 299–300, 308–309
- Tautology — 24, 97, 179, 189, 206

### electron/smart-language.cjs

- [Decision record](adr/library.md) — 1–5, 20–21, 44–45, 64–65, 70
- Tautology — 35–37

### electron/social-video.cjs

- Tautology — 48, 59, 72, 84, 85

### electron/symbol-render.cjs

- [Decision record](adr/desktop.md) — 12–16

### electron/test-mode.cjs

- [Decision record](adr/desktop.md) — 1–4, 10–12

### electron/update-signing.cjs

- [Decision record](adr/desktop.md) — 1–4, 12–15

### electron/updater.cjs

- [Decision record](adr/desktop.md) — 1–4

### electron/web-preview.cjs

- [Decision record](adr/desktop.md) — 53–54, 64–65

### electron/workbench.cjs

- [Decision record](adr/library.md) — 4–5, 19–23, 47–49, 123–125
- Stale — 57–58

### electron/yt-dlp.cjs

- [Decision record](adr/desktop.md) — 3–5, 75, 170–171

### native/Analyze.swift

- [Decision record](adr/distribution.md) — 8

### native/Symbols.swift

- Tautology — 3–6
- [Decision record](adr/distribution.md) — 44

### native/Text.swift

- [Decision record](adr/distribution.md) — 4–11, 31–32, 55–56

### scripts/build-mac.cjs

- [Decision record](adr/distribution.md) — 27–29

### scripts/generate-update-key.cjs

- [Decision record](adr/distribution.md) — 5–6

### scripts/package-release.cjs

- [Decision record](adr/distribution.md) — 8–9, 25, 42–44, 117–119

### scripts/prototype.cjs

- [Decision record](adr/distribution.md) — 1

### scripts/publish-release.cjs

- Tautology — 4–5

### scripts/set-fuses.cjs

- [Decision record](adr/distribution.md) — 10–12

### scripts/sign-update.cjs

- Tautology — 5–8

### scripts/smart/page.cjs

- [Decision record](adr/distribution.md) — 6–9, 28–29, 45–46, 59, 156–158, 176–177, 215–216, 232–234, 242, 255–256, 260

### scripts/smart/semantic-worker.mjs

- [Decision record](adr/distribution.md) — 4–7

### scripts/viewers/epub-worker.mjs

- [Decision record](adr/distribution.md) — 1–3

### scripts/viewers/formats.mjs

- [Decision record](adr/distribution.md) — 9–10

### src/app.js

- [Decision record](adr/gallery.md) — 17–18, 29–31, 34–36, 73–75, 95, 170–171, 201–202, 218–219, 221–223, 225–227, 242–244, 256–258, 308–311, 335–337, 352–355, 358–360, 368–371, 417–419, 428–430, 439–441, 465, 501–504, 531–532, 534–536, 598–600, 632–633, 730–731, 739–741, 775–777, 853–854, 860–862, 888–890, 893–895, 907–908, 986–989, 995–996, 1016–1018, 1042–1046, 1054–1055, 1074–1075, 1112–1113, 1125–1127, 1134–1135, 1137–1138, 1201–1203, 1248–1249, 1260–1261, 1265–1266
- Tautology — 301, 434–435, 493–494, 553, 607–609, 645–646, 663–664, 789–790, 869–870
- Stale — 589–590, 1175–1176

### src/bookmarks.js

- Excuse — 4–6 (#1)
- [Decision record](adr/gallery.md) — 60–62

### src/canvas-workspace.js

- [Decision record](adr/gallery.md) — 3–5, 7–10, 57–58, 68–69, 261–263, 267–269, 398, 402–403, 407–408, 575–577

### src/command-palette.js

- [Decision record](adr/interaction.md) — 1–5, 14–15, 140–141, 201–202, 300–303, 383–386, 458–459, 483–484
- Tautology — 69, 75, 93, 98

### src/context.js

- Tautology — 42–43, 46–47

### src/floating-player.css

- [Decision record](adr/appearance.md) — 91–92, 110–111, 140
- Stale — 122–123

### src/floating-player.js

- [Decision record](adr/interaction.md) — 4, 15–16, 21–23

### src/format-loader.js

- Tautology — 1

### src/index.html

- [Decision record](adr/interaction.md) — 58–59

### src/infinite-canvas.js

- [Decision record](adr/gallery.md) — 1–10, 16–17, 27–28, 43–45, 100–101, 130–131, 135, 145–146, 171–172, 206–208, 266–267, 277–279, 283–285, 323–324, 335–336, 367–368, 397–398, 413–415, 439–441, 450–451
- Excuse — 157–158 (#2)
- Tautology — 384

### src/islands.css

- Tautology — 1–9, 12, 20, 41, 52–53, 69, 81, 83, 91, 96, 103, 112, 118, 123, 138, 160, 166, 180, 195, 221
- [Decision record](adr/appearance.md) — 14–15, 24–28, 59–61, 144–147, 183–184, 214, 222–227, 259
- Stale — 189, 200

### src/layout.js

- Tautology — 41

### src/media.js

- [Decision record](adr/gallery.md) — 17–21, 59
- Tautology — 76

### src/motion.js

- [Decision record](adr/interaction.md) — 1–3, 13–14, 30–36, 60–61, 63–65, 77–79, 85–86, 96–97, 102–104
- Tautology — 19

### src/panel-resize.js

- [Decision record](adr/interaction.md) — 1–6, 17–18, 41–43, 150–152, 339–341, 364–365, 397–399
- Tautology — 413

### src/reliability.js

- Tautology — 9, 38

### src/select.css

- [Decision record](adr/appearance.md) — 1–7, 51–52, 132, 142
- Tautology — 36–37, 94, 125, 217–218

### src/select.js

- [Decision record](adr/interaction.md) — 1–10, 14–17, 55–56, 112–115, 143–145, 166, 247–248, 268–269, 271–272, 289–290
- Tautology — 81–82, 264–265, 279

### src/settings.js

- Tautology — 1–2, 174–175
- [Decision record](adr/interaction.md) — 6–7, 95–96, 123–124, 194–195, 374–375

### src/sidebar.css

- Tautology — 1, 19–22, 25, 50–51, 68–69
- Stale — 26, 29
- [Decision record](adr/appearance.md) — 33–34, 46–47, 58, 61–62, 97–99, 126–127

### src/sidebar.js

- [Decision record](adr/interaction.md) — 8–10, 23–24, 45–46, 129–130, 208, 253, 285, 325–327
- Stale — 74
- Tautology — 264–265

### src/smart-cards.js

- [Decision record](adr/gallery.md) — 25–28, 58–60, 75–76, 100–103, 108, 139–140, 142–144, 174–175, 211–212, 219–221, 285–287, 370–372
- Tautology — 200–201, 297

### src/smart-search.js

- [Decision record](adr/gallery.md) — 113–115, 199–200, 221–223, 265–267, 283–284, 290–291, 294
- Tautology — 154–155, 191–192, 202–203

### src/style.css

- Stale — 3, 2228–2229, 2334–2335, 5777–5778, 7204–7205
- Tautology — 9, 15, 29, 42, 60–61, 93–94, 102, 274–275, 295, 297–298, 475–476, 532–534, 618, 716–717, 789, 896, 1295, 1303–1304, 1666, 1740, 1806, 2115, 2198–2199, 2245–2246, 2363, 2382, 2514, 2521, 2788–2789, 2991, 3015, 3155, 3184, 3217, 3355, 3365–3366, 3534, 4180, 4244–4245, 4336, 4473, 4573, 5278–5279, 5300, 5302, 5305–5307, 5310, 5313, 5327, 5349, 5370–5371, 5579, 5828, 5861, 6415–6416, 6618, 6803–6804, 6820, 6831–6832, 6959, 7261–7262, 7399, 7466, 7484, 7507, 7529, 7541–7544, 7580, 7599, 7615, 7638, 7657, 7679, 7685, 7761–7763, 7787–7790, 7911–7913, 8083
- [Decision record](adr/appearance.md) — 31–32, 37–38, 63–64, 68–70, 87–88, 114, 158–160, 191–192, 366, 412–413, 482, 511–514, 572–573, 590–592, 916–918, 980–981, 997–999, 1001–1004, 1010–1011, 1299–1300, 1330, 1450–1453, 1489–1490, 1546–1548, 1622–1623, 1632–1633, 1682, 1831–1832, 2217–2219, 2231–2234, 2281–2283, 2294–2296, 2703–2704, 2729–2730, 2771–2772, 2851–2852, 2996–2997, 3007–3010, 3036–3039, 3047–3048, 3383–3384, 3473, 3500–3502, 3564–3565, 4331–4332, 4423–4424, 4548–4549, 4594–4595, 5282–5283, 5291–5292, 5330, 5332–5333, 5344–5345, 5398–5401, 5416–5417, 5511–5512, 5626–5628, 6274–6276, 6403–6406, 6571, 6583–6585, 6674–6678, 6710–6712, 6861–6863, 6871–6874, 6892, 6914, 6971–6977, 7094, 7235–7236, 7253–7254, 7275–7276, 7451, 7496–7497, 7691, 7699–7700, 7709–7712, 7715–7716, 7736–7737, 7740–7742, 7756–7757, 7803–7804, 7853–7855, 7957–7959, 7992–7993, 8060–8064, 8071–8072, 8084–8087, 8105–8109, 8124–8126
- Excuse — 7138–7140 (#3)

### src/symbols.js

- Stale — 1–9

### src/tag-suggestions.js

- [Decision record](adr/gallery.md) — 1–6, 20–21

### src/tag-vocabulary.js

- Tautology — 1–2

### src/view-preferences.js

- [Decision record](adr/interaction.md) — 51–54

### src/workbench.js

- Excuse — 2 (#1)
- [Decision record](adr/gallery.md) — 12–16, 63–64, 98–99, 111–112
- Tautology — 92–94, 103, 240, 240

### tests/audit-missing-file-electron.cjs

- Tautology — 1–2, 24, 32, 38

### tests/audit-regressions.test.cjs

- [Decision record](adr/testing.md) — 2

### tests/bookmark-workflows-electron.cjs

- Tautology — 1, 11, 13, 16, 18, 20, 22, 25, 64, 88

### tests/browser-extension.cjs

- Tautology — 1, 6–8, 50–51, 107–108, 133, 159–164
- [Decision record](adr/testing.md) — 20, 23–24, 55, 67–70, 82–84, 87–88, 90, 123–124, 143–144

### tests/canvas-electron.cjs

- [Decision record](adr/testing.md) — 1, 26–29, 93
- Tautology — 20, 22, 24, 74, 95

### tests/canvas-lifecycle-electron.cjs

- Tautology — 30

### tests/canvas-momentum-electron.cjs

- Tautology — 1–3, 39, 48, 52, 67

### tests/capture-canvas-view-electron.cjs

- Tautology — 1–3, 40, 46, 57, 59
- [Decision record](adr/testing.md) — 31–33

### tests/capture-network-electron.cjs

- [Decision record](adr/testing.md) — 1, 10

### tests/capture-refresh-electron.cjs

- Tautology — 1–2, 47

### tests/capture-startup-electron.cjs

- Tautology — 1–3, 27

### tests/capture-sync-electron.cjs

- Tautology — 1–2, 29, 41–42, 46

### tests/capture.test.cjs

- [Decision record](adr/testing.md) — 2

### tests/context-trash-electron.cjs

- Tautology — 1

### tests/drag-out-electron.cjs

- Tautology — 27–30, 56–57

### tests/extension-media.test.cjs

- Tautology — 1–3
- [Decision record](adr/testing.md) — 29–30

### tests/infinite-canvas-electron.cjs

- Tautology — 1–4, 33–34, 62–63, 71, 78, 84, 94–95, 118, 125–126, 131, 136, 141–144, 178–180, 210, 216
- [Decision record](adr/testing.md) — 103–104

### tests/infinite-perf-electron.cjs

- [Decision record](adr/testing.md) — 1–5

### tests/invariants.test.cjs

- Tautology — 1–4
- [Decision record](adr/testing.md) — 26–27

### tests/library-shot-electron.cjs

- Tautology — 1–2, 26

### tests/library-startup-failure-electron.cjs

- Tautology — 1–2, 11

### tests/native-macos-electron.cjs

- Tautology — 1–3, 22, 44, 54, 63, 88
- [Decision record](adr/testing.md) — 31, 71–72, 75–76, 79

### tests/navigation-canvas-electron.cjs

- [Decision record](adr/testing.md) — 11–12, 31–33, 89–91, 125–127

### tests/packaged-launch.cjs

- Tautology — 1

### tests/perceptual-hash.test.cjs

- [Decision record](adr/testing.md) — 22–24

### tests/preferences-electron.cjs

- Tautology — 1, 14, 17, 23, 24, 24, 27–28
- [Decision record](adr/testing.md) — 11

### tests/regressions/regressions.test.cjs

- Tautology — 1

### tests/release-package.cjs

- Tautology — 1

### tests/reliability-electron.cjs

- Stale — 5
- [Decision record](adr/testing.md) — 10–12

### tests/sidebar-electron.cjs

- Tautology — 1, 14–15, 30–31, 46–47, 55

### tests/smoke-electron.cjs

- Tautology — 1, 7–9, 112
- [Decision record](adr/testing.md) — 24, 37–39, 84

### tests/symbol-render.test.cjs

- [Decision record](adr/testing.md) — 26–27

### tests/traffic-light-electron.cjs

- Tautology — 1–3, 72
- [Decision record](adr/testing.md) — 19, 33–34, 44–45, 56

### tests/ui-audit-electron.cjs

- Tautology — 1–4, 38, 51, 58, 66, 106
- [Decision record](adr/testing.md) — 87–88, 94–95

### tests/update-signing.test.cjs

- [Decision record](adr/testing.md) — 11–13

### tests/updater.test.cjs

- [Decision record](adr/testing.md) — 315–316
- Tautology — 324–326

### tests/workbench.test.cjs

- Tautology — 9–11, 38
- [Decision record](adr/testing.md) — 54–55
