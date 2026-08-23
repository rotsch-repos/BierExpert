---
name: Monastic Modern
colors:
  surface: '#fcf9f3'
  surface-dim: '#dcdad4'
  surface-bright: '#fcf9f3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ed'
  surface-container: '#f0eee8'
  surface-container-high: '#ebe8e2'
  surface-container-highest: '#e5e2dc'
  on-surface: '#1c1c18'
  on-surface-variant: '#51443f'
  inverse-surface: '#31312d'
  inverse-on-surface: '#f3f0ea'
  outline: '#83746e'
  outline-variant: '#d5c3bc'
  surface-tint: '#7e5542'
  primary: '#351709'
  on-primary: '#ffffff'
  primary-container: '#4e2c1c'
  on-primary-container: '#c3927d'
  inverse-primary: '#f0bba4'
  secondary: '#8d4f00'
  on-secondary: '#ffffff'
  secondary-container: '#ffac5c'
  on-secondary-container: '#744000'
  tertiary: '#1d2212'
  on-tertiary: '#ffffff'
  tertiary-container: '#323726'
  on-tertiary-container: '#9ba08a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcc'
  primary-fixed-dim: '#f0bba4'
  on-primary-fixed: '#301406'
  on-primary-fixed-variant: '#633e2c'
  secondary-fixed: '#ffdcc0'
  secondary-fixed-dim: '#ffb876'
  on-secondary-fixed: '#2d1600'
  on-secondary-fixed-variant: '#6b3b00'
  tertiary-fixed: '#e0e5cc'
  tertiary-fixed-dim: '#c4c9b1'
  on-tertiary-fixed: '#191d0e'
  on-tertiary-fixed-variant: '#444937'
  background: '#fcf9f3'
  on-background: '#1c1c18'
  surface-variant: '#e5e2dc'
typography:
  display-lg:
    fontFamily: EB Garamond
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 56px
    letterSpacing: -0.01em
  display-lg-mobile:
    fontFamily: EB Garamond
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: EB Garamond
    fontSize: 32px
    fontWeight: '500'
    lineHeight: 40px
  headline-sm:
    fontFamily: EB Garamond
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
  mono-data:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
---

## Brand & Style
The design system bridges the gap between centuries-old brewing tradition and contemporary digital expertise. It evokes the atmosphere of a historic monastery library—quiet, authoritative, and tactile—while maintaining the functional precision of a modern connoisseur's tool.

The aesthetic leans into **Minimalism with Tactile influences**. It avoids "kitsch" by using generous whitespace and structural grid alignment, while introducing character through "masonry" inspired depth and "plaster" textures. The emotional response should be one of quiet confidence, heritage, and uncompromising quality.

## Colors
The palette is rooted in the organic process of brewing and the materials of the monastery. 
- **Primary (Walnut/Deep Brown):** Used for typography, primary branding, and heavy structural elements. 
- **Secondary (Ochre/Rust):** Reserved for call-to-actions and highlighting craftsmanship (e.g., ABV badges, rating stars).
- **Tertiary (Olive/Clay):** Used for subtle categorization and secondary status indicators, providing a cool relief to the warm palette.
- **Surface Strategy:** Use `surface_cream` for main content areas to ensure high readability. Use `background_paper` for the global canvas. High contrast is maintained by using `ink_dark` for all body text.

## Typography
The typographic hierarchy pairs the literary elegance of **EB Garamond** with the clean, architectural precision of **Hanken Grotesk**. 

- **Headlines:** Use EB Garamond for all editorial titles and product names. It should feel like a historic label but rendered with modern crispness.
- **Body:** Hanken Grotesk provides high legibility for long-form tasting notes and technical data.
- **Labels:** Use the uppercase `label-caps` for metadata like "STYLE", "ORIGIN", or "BREWERY" to create a distinct visual rhythm.

## Layout & Spacing
The design system utilizes a **12-column fluid grid** for desktop and a **4-column grid** for mobile. 

- **Rhythm:** All vertical spacing must be a multiple of 8px. Use 64px (8 units) between major sections to maintain a sense of "monastic" space and breathability.
- **Containment:** Content is centered in a 1280px container on large screens. 
- **Density:** Technical data (ABV, IBU) should be grouped tightly using 8px or 16px gaps, while editorial content should use 32px+ gaps to allow for a relaxed reading experience.

## Elevation & Depth
This design system avoids heavy drop shadows, opting instead for **Tonal Layers** and **Subtle Outlines**.

- **Surfaces:** Use 1px solid borders in `border_warm` to define cards and containers.
- **Depth:** To indicate elevation (like a hovered card), use a very soft, diffused shadow: `0 4px 20px rgba(78, 44, 28, 0.08)`.
- **Texture:** Apply a subtle noise or "plaster" SVG filter (opacity 2-3%) to the `background_paper` to create a handcrafted feel that mimics physical masonry or heavy stationery.

## Shapes
The shape language is **Soft (0.25rem)**. This provides a slight hint of organic material without losing the structured, professional look of the UI.

- **Standard Elements:** Buttons and input fields use a 4px (0.25rem) radius.
- **Cards:** Beer and article cards use an 8px (0.5rem) radius to feel like solid, cut objects.
- **Interactive States:** Avoid perfectly circular "pill" buttons; keep them rectangular with soft corners to maintain the architectural theme.

## Components
- **Beer Cards:** Use a vertical layout. The image of the bottle/glass sits on a `surface_cream` background. Metadata (ABV, Style) is placed at the bottom in `label-caps` typography, separated by thin `border_warm` horizontal lines.
- **High-Quality Buttons:**
    - *Primary:* Solid `primary_color_hex` with `surface_cream` text.
    - *Secondary:* `border_warm` outline with `primary_color_hex` text.
- **Engraving-Style Icons:** Icons should be thin-stroke (1px to 1.5px), monochromatic, and slightly distressed or "hand-drawn" in appearance, never filled or "bubbly."
- **Input Fields:** Use a subtle `background_paper` fill with a bottom-border only for a "ledger" or "manuscript" feel, or a full 1px border for search bars.
- **Article Cards:** Feature a large serif headline overlapping a subtle clay-colored background block, emphasizing the "editorial" nature of the expert content.
- **Badges:** Small, square-ish tags for "Aged," "Rare," or "Organic" using the `tertiary_color_hex` (Olive) to signify natural qualities.