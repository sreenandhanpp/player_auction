# Auction Arena

A browser based multiplayer football player auction game. Each room supports 2–4 players, eight shuffled auctions, 100 coins per player, secret bids, a 15 second timer, rosters of up to four players, and a +5 complete-role-set bonus.

## Run it

Requires Node.js 18 or newer. From this folder:

```sh
npm start
```

Open http://localhost:3000. To play across devices, run the server on a reachable host and share the room invite link. The server must stay running while a round is in progress.

## Game rules

- The host starts once at least two players have joined.
- Each round reveals a player and rating; the next card remains unknown.
- Bids are private and lock when submitted. A missing bid is treated as zero.
- Highest bid wins and pays that amount. Tied bids go first to the smaller roster, then to the player with more coins, then by room order.
- If someone explicitly leaves during a game, they forfeit. A lost browser connection is detected after 12 seconds without a heartbeat; the disconnected player is removed and the auction continues with the remaining players. The last player standing wins by forfeit.
- After eight auctions, highest rating total wins. Completing all four roles (Forward, Midfielder, Defender, Goalkeeper) adds five points. Tied scores are decided by remaining coins.

Player names, teams, roles, and game ratings use a small built-in pool. The app looks up player photos from TheSportsDB's free API when available and falls back to initials when it is unavailable. The 1–10 game ratings are curated for this game's scoring and are not API ratings. New players enter a display name and select a favorite club; the profile is saved in that browser and shown in the room. Room state lives in server memory, so restarting the server clears active rooms.
