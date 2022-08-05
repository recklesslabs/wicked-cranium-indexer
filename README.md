# Wicked Cranium Indexer

This indexer fetches all `Transfer` events on the The Wicked Cranium [contract](https://etherscan.io/address/0x85f740958906b317de6ed79663012859067e745b) every **5 minutes** and updates a Firestore database with up-to-date ownership for every token.

## Cloud Database

The Firestore database _definition_ is as follows:

[`wicked-cranium-owners`](https://console.firebase.google.com/u/0/project/wicked-cranium-owners/firestore) is a set of following Collections.

- Collection `address_to_tokens`

  Each document within this collection is a unique address (owner) and has the field of the shape `{ token: String[] }` where `String[]` represents the tokens numbers owned by the owner.

- Collection `tokens_to_address`

  Each document within this collection is a unique token number and has the field of the shape `{ owner: String }` where `String` represents the owner of the given token.

- Collection `last_update_block`

  This collection just has one document - `last_update_block` and the field is of the shape `{ block: String }` where the String represents the last [block number](https://etherscan.io/blocks) the database was updated.

## Cloud Function

I'm using a Firebase Cloud Function that triggers [on a schedule](https://firebase.google.com/docs/functions/schedule-functions) of 5 minutes. Find the source Code in [`index.js`](./index.js).

## Utils

Some useful scripts used to fetch, populate, and emulate can be found in [**`utils/README.md`**](./utils/README.md)
