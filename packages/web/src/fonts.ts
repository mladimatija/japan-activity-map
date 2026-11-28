/**
 * The site's own typefaces, served with it: a published site allows fonts from its own origin only
 * (font-src 'self'), and no reader's visit should reach a font host. Each stylesheet has a file
 * per script with its range of characters, so the browser fetches only the scripts a page uses: a
 * reader downloads the Latin files (about 130 kB, more where names have macrons) and nothing
 * else. IBM Plex Sans is one variable file for every weight; the Condensed cut sets titles and
 * figures. Japanese is left to the reader's system fonts (the stacks in index.css).
 */
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-sans-condensed/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
