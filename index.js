const { initializeApp, applicationDefault, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAddress } = require("@ethersproject/address");

const functions = require("firebase-functions");
const Moralis = require("moralis/node");
const admin = require("firebase-admin");

let moralisServerUrl = process.env.MORALIS_SERVER_URL;
let moralisAppId = process.env.MORALIS_APP_ID;
let moralisMasterKey = process.env.MORALIS_MASTER_KEY;

const serverUrl = moralisServerUrl;
const appId = moralisAppId;
const masterKey = moralisMasterKey;

admin.initializeApp();

const db = getFirestore();

// Environment variables
// - MORALIS_SERVER_URL
// - MORALIS_APP_ID
// - MORALIS_MASTER_KEY
// - CHAIN
// - CONTRACT_ADDRESS
// - ABI
// - EVENT_TOPIC
// - EVENTS_LIMIT

exports.updateDB = functions.pubsub.schedule("every 5 minutes").onRun(async (context) => {
  Moralis.start({ serverUrl, appId, masterKey });

  let currentTime = Math.round(new Date().getTime() / 1000).toString();

  let toBlock = await Moralis.Web3API.native.getDateToBlock({
    chain: process.env.CHAIN,
    date: currentTime,
  });
  let toBlockStr = toBlock.block.toString();

  let fromBlock = await db.collection("last_update_block").doc("last_update_block").get();
  let fromBlockData = fromBlock.data();
  let fromBlockStr = fromBlockData.block;

  let CHAIN = process.env.CHAIN;
  let CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  let EVENT_TOPIC = process.env.EVENT_TOPIC;
  let EVENTS_LIMIT = process.env.EVENTS_LIMIT;
  let ABI = JSON.parse(process.env.ABI);

  let options = {
    chain: CHAIN,
    address: CONTRACT_ADDRESS,
    topic: EVENT_TOPIC,
    limit: EVENTS_LIMIT,
    abi: ABI,
    // increment from block to not include txs from previous update
    from_block: (parseInt(fromBlockStr) + 1).toString(),
    to_block: toBlockStr,
  };

  let transfersResponse = await Moralis.Web3API.native.getContractEvents(options);

  let latestBlock;
  if (transfersResponse.result.length > 0) {
    latestBlock = Math.max(...transfersResponse.result.map((e) => parseInt(e.block_number))).toString();
  }

  let fullTransfersArr = transfersResponse.result;

  while (transfersResponse.hasOwnProperty("next")) {
    functions.logger.log("Fetch", { data: transfersResponse.result });
    await new Promise((r) => setTimeout(r, 1000));
    transfersResponse = await transfersResponse["next"]();
    fullTransfersArr = [...fullTransfersArr, ...transfersResponse.result];
  }

  fullTransfersArr.sort((a, b) => parseInt(a.block_number) - parseInt(b.block_number));

  for (let i = 0; i < fullTransfersArr.length; i++) {
    // "getAddress" does checksum of the address, intial entries already checksummed.
    let from = getAddress(fullTransfersArr[i].data.from);
    let to = getAddress(fullTransfersArr[i].data.to);
    let tokenId = fullTransfersArr[i].data.tokenId;

    functions.logger.log("Updating DB", {
      data: fullTransfersArr[i],
    });

    const address_to_tokens_from_ref = db.collection("address_to_tokens").doc(from);
    const address_to_tokens_to_ref = db.collection("address_to_tokens").doc(to);

    const tokens_to_address_token_ref = db.collection("tokens_to_address").doc(tokenId);

    const address_to_tokens_from = await address_to_tokens_from_ref.get();
    const address_to_tokens_to = await address_to_tokens_to_ref.get();

    if (address_to_tokens_from.exists) {
      address_to_tokens_from_ref.update({
        tokens: FieldValue.arrayRemove(tokenId),
      });
    } else {
      functions.logger.log(`We're trying to transfer tokens from someone that does not exist!`, {
        val: fullTransfersArr[i],
      });
    }

    if (address_to_tokens_to.exists) {
      await address_to_tokens_to_ref.update({
        tokens: FieldValue.arrayUnion(tokenId),
      });
    } else {
      await address_to_tokens_to_ref.set({
        tokens: [tokenId],
      });
    }

    await tokens_to_address_token_ref.set({ owner: to });
  }

  if (fullTransfersArr.length > 0) {
    await db.collection("last_update_block").doc("last_update_block").set({ block: latestBlock });
  }

  return null;
});
