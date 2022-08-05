# Useful utilities

These snippets can be used as scripts

## Populating Firestore when testing with Emulation.

When running the emulator, use the following to initialize firestore (Note that non deployed production functions use `admin.initializeApp()` for initialization).

```js
const serviceAccount = require("../service-account-key.json");

initializeApp({
  credential: cert(serviceAccount),
});
```

And change the function header to the following to run it on-demand

```js
functions.https.onRequest(async (request, response) => { ... });
```

The function needs some data to operate on, use a `SETUP` flag to do so, and rerun the function.

```js
await db.collection("last_update_block").doc("last_update_block").set({ block: "7331582" });

if (SETUP) {
  await db
    .collection("address_to_tokens")
    .doc("0xf733aef047f0fdfe3fe181c0a7dadf8d793fc88e")
    .set({
      tokens: Array.from(Array(40).keys()).map((e) => e.toString()),
    });
  for (let i = 0; i < 40; i++) {
    await db.collection("tokens_to_address").doc(i.toString()).set({
      owner: "0xf733aef047f0fdfe3fe181c0a7dadf8d793fc88e",
    });
  }
  response.json({
    data: "setup",
  });
} else {
  return null;
}
```

## Fetching all owners using Infura and Ethers

Moralis seemed to keep failing for me, so I used Infura and Ethers to get owners of each token. Appending each response to a file makes it
easy to restart from where we left off in case of a failure.

```js
let ethers = require("ethers");
let fs = require("fs");
require("dotenv").config();

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const CONTRACT_ABI = JSON.parse(process.env.CONTRACT_ABI);

let provider = new ethers.providers.InfuraProvider(process.env.CHAIN, process.env.INFURA_KEY);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

async function getOwners(startTokenId, endTokenId, outFile) {
  for (let i = startTokenId; i < endTokenId; i++) {
    let addr = await contract.ownerOf(i);
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(outFile, `${JSON.stringify({ token: i, owner: addr })}\n`, { flag: "a+" });
  }
}

getOwners(1, 10762, "tokenOwnership.json");
```

## Verify Checksum of fetched owners

Here's a simple script to verify that all owner addresses are checksummed. A checksummed address has a specific casing convention. We make
sure that we only add and compare checksummed address. This is important to keep the database sound.

```js
const fs = require("fs");
const { getAddress } = require("@ethersproject/address");

function ownersList() {
  let json = JSON.parse(fs.readFileSync(fileName, { encoding: "utf-8" }));
  let owners = json.data.map((e) => e.owner);
  return owners;
}

function verifyChecksumAll(addresses) {
  addresses.forEach((addr) => {
    console.log(addr === getAddress(addr));
  });
}

verifyChecksumAll(ownersList(fileName));
```

## Initially fetched data to Firestore-ready definition

After fetching owners of each token ID, we need to also compute mapping from owners to the tokens they own. The initial database also
requires the initial "from_block" number it needs to start indexing from.

```js
const fs = require("fs");

function fetchedDataToDB(inFile, outFile, startBlock) {
  let data = JSON.parse(fs.readFileSync(inFile, { encoding: "utf-8" }));

  let addressToTokens = {};
  let tokensToAddress = {};

  console.log(data.data.length);

  for (let i = 0; i < data.data.length; i++) {
    let fetchedDatum = data.data[i];
    tokensToAddress[fetchedDatum.tokenId] = fetchedDatum.owner;
    if (addressToTokens[fetchedDatum.owner] !== undefined) {
      addressToTokens[fetchedDatum.owner] = [...addressToTokens[fetchedDatum.owner], fetchedDatum.tokenId];
    } else {
      addressToTokens[fetchedDatum.owner] = [fetchedDatum.tokenId];
    }
  }

  let db = {
    address_to_tokens: addressToTokens,
    tokens_to_address: tokensToAddress,
    last_update_block: startBlock.toString(),
  };

  fs.writeFileSync(outFile, JSON.stringify(db));
}

fetchedDataToDB(inFile, outFile, startBlock);
```

## Upload the initial database to Firestore

Once the right data definition is constructed, we can start populating the initial database
