// Ryujin OS — DEPRECATED global nav-buttons injector.
// Removed May 7 2026: caused duplicate back buttons (per-page topbar back +
// this floating fixed pair), z-index collisions with chat fab on mobile, and
// a fallback that dropped users all the way to /admin.html instead of one
// level up. Per-page topbar back buttons (.btn-back / .tb-icon) handle
// navigation correctly and respect hierarchy. This file is retained as a
// no-op so any cached <script src="/assets/nav-buttons.js"> tags don't 404.
//
// Do NOT add inject logic back here. If a page needs a back button, add a
// .btn-back element in its topbar that points to its parent page.
