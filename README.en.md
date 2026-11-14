# Facebook Post Archive

[繁體中文](README.md)

Turns the posts and photos in your Facebook export into an offline archive that looks like a Facebook profile: cover photo, profile picture, intro, posts, photos and friends. Everything is processed locally in your browser.

## How to use it

1. Open `index.html` from the top folder of this project in your browser.
2. In Facebook, go to Settings & privacy › Settings › Accounts Center › Your information and permissions › Export your information. Choose the profile to save and export to your device. JSON, All time and High media quality work best. Include "Groups" if you want group posts, and "Personal information" and "Connections" for the profile intro and friends. [Facebook Help](https://www.facebook.com/help/212802592074644)
3. Choose "Choose ZIP files" and select every part of the same export at once. Data you have already extracted can be opened with "Choose extracted folder".
4. On Posts, use "Filters" to search by keyword or pick a year. The Photos tab has all photos, albums and videos. Click a photo to see it full size and use the arrow keys to move between photos. "Import report" lists missing attachments, photos that are only links, and anything that couldn't be matched.
5. Choose "Save offline archive ZIP". Extract the whole ZIP and open the `index.html` inside to browse it again. Keep the original Facebook ZIP so you can check against it later.

Comments you wrote and reactions you gave are in the "Activity log", sorted by date. A Facebook export only contains your own comments and reactions, not other people's reactions and comments on your posts, so posts show no interaction counts.

The page follows your browser's language (Traditional Chinese or English). Use the language menu at the top right to switch; the choice is remembered in that browser. Text that Facebook wrote into the export, such as post titles and album names, is shown as exported.

The archive can only contain what was exported. Posts or attachments missing from the export entirely can't be detected by the import report.

## Changelog

### 0.2.0

- The archive now looks like a Facebook profile: cover photo, profile picture, intro, posts, photos, friends and an activity log.
- The interface can be switched between Traditional Chinese and English.
- Fixes:
  - The import report's reaction count now matches the activity log. Each reaction is counted once.
  - Post audience settings are no longer read as reactions.
  - Friend lists split across several files are read in full.
  - Opening another export clears the friend and activity log searches.
  - Names containing 在 or 和 are no longer cut short.
  - When no name is found, the post author is no longer shown twice.
  - Shared memories no longer say the original isn't in the export.
  - The language can't be switched during import or save.
  - Uses less memory, and the Photos tab opens faster.

### 0.1.0

- First alpha.
