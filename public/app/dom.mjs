// DOM helpers shared by every view, kept free of imports so the public account app can load them without any session data.
export const ic = n => `<svg><use href="icons.svg#i-${n}"/></svg>`;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
