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

I used Infura and Ethers to get owners of each token. Appending each response to a file makes it easy to restart from where we left off in case of a failure.

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

Here is another version using Moralis, although this is more prone to crashing mid way and does not provide the tokens in order so harder to restart in case of a failure.

```js
require("dotenv").config();
const fs = require("fs");

let moralisServerUrl = process.env.MORALIS_SERVER_URL;
let moralisAppId = process.env.MORALIS_APP_ID;
let moralisMasterKey = process.env.MORALIS_MASTER_KEY;

const Moralis = require("moralis/node");

const serverUrl = moralisServerUrl;
const appId = moralisAppId;
const masterKey = moralisMasterKey;

const fetchAllOwnersMoralis = async () => {
  await Moralis.start({ serverUrl, appId, masterKey });

  let options = {
    address: process.env.NFT_CONTRACT_ADDRESS,
    chain: "eth",
    limit: 100,
  };

  let currentPage = await Moralis.Web3API.token.getNFTOwners(options);
  let res = currentPage.result;

  let cursorToken = currentPage.cursor;

  while (cursorToken !== null) {
    await new Promise((r) => setTimeout(r, 10000));
    options["cursor"] = currentPage.cursor;
    currentPage = await Moralis.Web3API.token.getNFTOwners(options);
    cursorToken = currentPage.cursor;
    res = res.concat(currentPage.result);
  }

  return { data: res.map((e) => ({ token: e.token_id, address: e.owner_of })) };
};

fetchAllOwnersMoralis();
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

```js
const { initializeApp, applicationDefault, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const fs = require("fs");

async function initialDBUpload(jsonDBFile) {
  const serviceAccount = require("./service-account-key.json");

  initializeApp({
    credential: cert(serviceAccount),
  });

  const db = getFirestore();

  let { address_to_tokens, last_update_block, tokens_to_address } = JSON.parse(
    fs.readFileSync(jsonDBFile, { encoding: "utf-8" })
  );

  let all_addresses = Object.keys(address_to_tokens);

  for (let i = 0; i < all_addresses.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    let address = all_addresses[i];
    let tokensArr = address_to_tokens[address];
    await db.collection("address_to_tokens").doc(address).set({
      tokens: tokensArr,
    });
  }

  let all_tokens = Object.keys(tokens_to_address);
  for (let i = 0; i < all_tokens.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const token = all_tokens[i];
    const addr = tokens_to_address[token];
    await db.collection("tokens_to_address").doc(token).set({
      owner: addr,
    });
  }

  await db.collection("last_update_block").doc("last_update_block").set({
    block: last_update_block,
  });
}

initialDBUpload(jsonDBFile);
```
