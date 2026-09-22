# Design QA

- Source visual truth: `/var/folders/fq/czqgcqr91n5g_sxmhc41h_x00000gn/T/codex-clipboard-6612d01f-b981-4adf-89b6-4e8c6e574b29.png`
- Source dimensions: 1024 × 1536 px; two-device presentation board used as a layout reference, not as a 1:1 phone capture.
- Implementation: `http://localhost:3000/`, captured in the Codex in-app browser through a temporary 390 × 844 CSS px viewport frame. The browser capture API did not expose a filesystem screenshot path.
- State: empty account with no dictionaries; closed onboarding and open add-method bottom sheet.
- Density normalization: visual regions were compared at their rendered CSS proportions; surrounding presentation canvas and mock device chrome were excluded.

**Full-view comparison evidence**

- The mobile hierarchy matches the reference: compact brand/account header, full-width empty dictionary selector, large illustration, centered onboarding copy, one dominant add button, and a low-emphasis training hint.
- The requested standalone “Создать словарь” action is intentionally absent.
- The open state uses a dimmed backdrop and rounded bottom sheet with drag handle, title, close control, and the three existing add-method cards.

**Focused region comparison evidence**

- Header: “Нет словарей” is the only selector label and the desktop onboarding title is hidden.
- Primary action: the CTA is full-width with a mobile-sized 58 px touch target.
- Bottom sheet: “Одно слово”, “Группа слов”, and “Фото или файл” preserve their existing icons, copy, colors, and card styling.
- Training hint: the supplied vocabulary-card illustration, heading, and secondary copy render without overlap.

**Required fidelity surfaces**

- Fonts and typography: existing Geist and brand typography retained; mobile heading weight, size, wrapping, and secondary text hierarchy align with the reference.
- Spacing and layout rhythm: vertical order and section gaps match the reference while fitting the existing 390 px responsive breakpoint.
- Colors and visual tokens: existing Lingua cream, green, neutral card, overlay, radius, and shadow tokens retained.
- Image quality and asset fidelity: existing supplied onboarding illustration is used directly with a wider mobile crop; no placeholder or code-drawn replacement.
- Copy and content: the introduction is shorter for mobile, the primary action is “Добавить слова”, and no separate “Создать словарь” action appears.

**Comparison history**

1. Initial pass found two P2 issues: the disabled “Учить слова” control remained above the illustration, and the training hint icon was missing.
2. Fixed by hiding the empty-training rail block only on mobile, restoring the intended top spacing, and adding the supplied vocabulary-card illustration as a local asset.
3. Post-fix captures confirmed the closed state and open bottom sheet have no overlap, unintended controls, or actionable P0/P1/P2 mismatch.

**Findings**

- No actionable P0, P1, or P2 findings remain.

**Follow-up polish**

- P3: verify the exact lower-card position on a physical device with browser chrome and safe-area insets.

**Implementation checklist**

- [x] Empty mobile onboarding follows the selected composition.
- [x] No standalone “Создать словарь” button.
- [x] Add-method items retain their existing visual style.
- [x] Bottom sheet opens and closes accessibly.
- [x] Desktop layout remains unchanged.

final result: passed
