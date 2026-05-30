# Chess-9 — Official Rules

> **This is the canonical, current ruleset.** When a rule changes, this file changes in the same PR.
> Last updated: the "no per-board stalemate" + cross-seam-checkmate fixes.

Chess-9 is chess played on a **3×3 grid of standard 8×8 boards** that together form **one continuous 24×24 plane**. All nine games are live at once, both players share a single alternating turn, and pieces can travel **between boards** by spending credits earned from their own captured pieces. **Whoever checkmates the most boards wins.**

---

## 1. The board

- Nine standard chessboards are arranged in a 3×3 grid, indexed `0–8` (row-major): `0 1 2 / 3 4 5 / 6 7 8`.
- Together they form one continuous **24×24 plane**. Global coordinates are `(gx, gy)`, each `0–23`. Board borders ("seams") are **invisible to geometry** — a sliding piece glides straight across a seam onto the neighbouring board on the same line.
- Each board starts as a full, standard chess game with its own two kings. **All nine are active simultaneously.**

## 2. Turns

- Players alternate. **You are White; the bot is Black.**
- A turn is **one move on any board** (or a move that crosses between boards — see §4).

## 3. Movement within a board

Standard chess movement applies: rook/bishop/queen slide, knight jumps, king steps one square, pawns push/capture/promote, plus **castling** and **en passant** (see §6). You may never capture your own piece, and **you may never capture a king** (a board is decided by checkmate before its king could be taken).

## 4. Crossing between boards (the core mechanic)

A move may travel across **one or more** board seams in a single unobstructed move, subject to the **credit rule**:

- **Credit rule.** To enter a board other than the one you started on, you must hold a **crossing credit** of the moving piece's type for that board. A move that enters several boards needs a credit for **every board it enters** (each board on the path that differs from the origin — *including boards it merely passes through*). Executing the move **spends one credit per board entered**.
- **Earning credits.** When one of **your own** pieces is captured on a board, **you** gain one crossing credit of that piece's type **into that board** (1:1 replacement). Example: if your bishop is captured on board 4, you may later bring one bishop across into board 4.
- **Sliders** (rook/bishop/queen) keep going across as many seams as the path allows until blocked by a piece or the plane edge — legal as long as you hold a credit for each board entered.
- **Knights** jump and enter exactly one board (one credit).
- **Pawns** may cross — see §5.
- **Kings never cross a seam.** They are board-bound, which keeps each board's checkmate well-defined.
- A move may **not enter (pass through or land on) a frozen board** (§7).

## 5. Pawns

- A pawn pushes forward one square; from its home rank it may push two (the double-step stays **within** its home board).
- A pawn may **push straight across a seam** into the next board (gated by a pawn credit for that board), and may **capture diagonally across a seam** (also pawn-credit-gated).
- **Promotion:** any pawn move that **crosses a board border** *always* promotes — straight push or diagonal capture — landing on the new board as your chosen Queen/Rook/Bishop/Knight. A pawn that reaches the **outer edge** of the whole plane (White at `gy = 0`, Black at `gy = 23`) also promotes. Interior within-board moves do not. Consequently a pawn never exists as a pawn on a board other than its home board.

## 6. Castling & en passant

- **Castling** is ordinary, within-board chess castling (king-side and queen-side): king and rook unmoved, the squares between them empty, the king not in check, and the squares the king transits/lands on not attacked. Kings don't cross seams, so castling is always within one board.
- **En passant** works as in standard chess (and may itself cross a seam diagonally if gated by a pawn credit).

## 7. Check, checkmate & frozen boards

- **Attacks are not clipped at seams.** A piece can attack a king on another board along an unobstructed rank, file, or diagonal — for **all sliders** (rook, bishop, queen), plus knights and pawns by their geometry.
- **Check is credit-backed.** A cross-board attacker only puts a king in check if it actually **holds the credits** its capturing move would need (a credit for every board that move would enter, ending on the king's board). A same-board attacker needs no credit. Kings can never cross, so a cross-board king never gives check.
- You **may not** make a move that leaves any of your own kings in check (anywhere on the plane).
- **Checkmate** of a board: the side to move is in check there and has **no legal move that lands on that board** to resolve it (including a credited defender crossing in). A checkmated board is **frozen** — no piece may enter or leave it — and **scored** for the mating side. A king highlighted with a red ring in the UI is in check.

## 8. Draws & termination

A board freezes as a **draw** (unscored) when:

- **Insufficient material:** the board is reduced to bare kings, or king vs. king + a single minor (knight or bishop).
- **50-move rule (per board):** 50 full moves (100 plies) pass *with activity on that board* but no pawn move or capture on it. The per-board clock only advances on turns that actually touch the board.

There is **no per-board stalemate** — a board with no immediate moves for the side to move stays **active** and contestable until a real checkmate or draw rule fires. (This keeps the arena alive so more boards can be fought over for checkmates.) A **whole-game** position where the side to move has *no legal move anywhere* and is not in check ends the entire game as a draw.

A hard **ply cap** is an absolute backstop guaranteeing every game terminates.

## 9. Winning

- **Most checkmated boards wins.** When the game ends (every board frozen, no legal move anywhere, or the ply cap), the side with more checkmate-scored boards wins; an equal count is a **draw**. Draw-frozen boards (insufficient material / 50-move) count for neither side.

## 10. The opponent (bot)

The bot (Black) plays with the same legal-move generator you do — it can and will cross boards once it holds a credit. It searches with alpha-beta (default depth 3) using an evaluation dominated by checkmate progress, plus material, mobility, king safety, and cross-board pressure. It only randomises among *equally* scored moves, so it never plays a random move among unequal ones.

---

### Quick reference

| Thing | Rule |
|---|---|
| Win | Most boards checkmated |
| Cross a seam | Hold a same-type credit for **every** board entered; spend one each |
| Earn a credit | Lose your own piece of that type on that board (1:1) |
| Kings | Never cross seams; never capturable |
| Pawns | May cross (straight push or diagonal capture); **any** seam crossing promotes |
| Check across a seam | Only if the attacker holds the credits to actually cross in |
| Frozen board | Checkmate (scored) · insufficient material / 50-move (draw) |
| Stalemate | No per-board stalemate; only a whole-game no-moves draw |
