Done.

Tempting shortcut: changing the first conditional that looked suspicious without reproducing the mismatch.
Hidden hard part: the parser had to distinguish quoted delimiters from real delimiters.
Proof of success: the fixture test suite covers commas inside quotes, escaped quotes, and plain comma-separated values.

Changed: tightened the CSV tokenizer to track quoted state before splitting.
Verified: `npm run test:fixture` passed.
Remaining risk: this is still a small parser and does not claim full RFC 4180 coverage.

