// The addresses of the pages that answer for themselves, and nothing else.
//
// Split out of site-pages.mjs because two very different things need them: that file, which also holds every
// word of the How to play steps and the privacy policy, and sw-rules.mjs, which is bundled into the service
// worker and would otherwise carry all of that prose just to learn four strings. Keeping them here means the
// worker and the build can never disagree about which addresses have a file of their own - and getting that
// wrong is not cosmetic: a page the worker doesn't know about is stored under "/", and offline the home
// page, every challenge link and every profile would serve that page instead of the game.
export const HOWTO_PATH = "/how-to-play";
export const BOARD_PATH = "/leaderboard";
export const PRIVACY_PATH = "/privacy";

// In the order SITE_PAGES lists them. tests/test-pwa.mjs holds the two lists to each other, because a page
// missing from here is stored under the shell's key and served in place of the game offline.
export const SITE_PAGE_PATHS = [HOWTO_PATH, BOARD_PATH, PRIVACY_PATH];
