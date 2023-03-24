import axios from 'axios';
import fs from 'fs';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import * as ftp from 'basic-ftp';
import csvToJson from 'convert-csv-to-json';
import decodeHtml from 'decode-html';
import { xml2js } from 'xml-js';
import { postLipseysProducts } from './listLipseys/index.js';
import { postDavidsonsProducts } from './listDavidsons/index.js';
import { postRSRProducts } from './listRSR/index.js';
import { postSSProducts } from './listSportsSouth/index.js';
import { fixImages } from './imageFixer.js';

dotenv.config();

function logProcess(message, type){
  console.log("_________________________________________________________________________________");
  switch(type){
    case 'good':
      console.log(chalk.green(message));
      break;
      case 'bad':
        console.log(chalk.red(message));
        break;
      case 'warning':
        console.log(chalk.yellow(message));
        break;
      default:
        console.log(chalk.magenta(message));
  }
}

let GunBrokerAccessToken = new Promise(function(resolve,reject){
  const gunbroker_credentials = { "Username": process.env.GUNBROKER_USERNAME, "Password": process.env.GUNBROKER_PASSWORD };
  axios.post('https://api.gunbroker.com/v1/Users/AccessToken', gunbroker_credentials,{
  headers: {
    'Content-Type': 'application/json',
    'X-DevKey': process.env.GUNBROKER_DEVKEY
  },
  })
  .then(function (response) {
    resolve(response.data.accessToken);
  })
  .catch(function (error) {
    reject(new Error(error));
  });
});

let currentUserID = new Promise( async (resolve, reject) => {
  let token = await GunBrokerAccessToken;
  axios.get('https://api.gunbroker.com/v1/Users/AccountInfo',{
    headers: {
      'Content-Type': 'application/json',
      'X-DevKey': process.env.GUNBROKER_DEVKEY,
      'X-AccessToken': token
    },
  })
  .then(function (response) {
    resolve(response.data.userSummary.userID);
  })
  .catch(function (error) {
    reject(new Error(error));
  });
});

function checkAlreadyPosted(upc){
  return new Promise( async (resolve, reject) => {
    let userID = await currentUserID;
    let token = await GunBrokerAccessToken;
    axios.get('https://api.gunbroker.com/v1/Items?IncludeSellers='+userID+'&UPC='+upc,{
      headers: {
        'Content-Type': 'application/json',
        'X-DevKey': process.env.GUNBROKER_DEVKEY,
        'X-AccessToken': token
      },
    })
    .then(function (response) {
      if(response.data.countReturned > 0){
        // Product Already Posted
        resolve(true);
      }else{
        resolve(false);
      }
    })
    .catch(function (error) {
      console.log(error);
      reject(new Error(error));
    });
  });
}

function getAllListings(){
  return new Promise( async (resolve, reject) => {
    let userID = await currentUserID;
    let token = await GunBrokerAccessToken;
    await axios.get('https://api.gunbroker.com/v1/Items?BuyNowOnly=true&PageSize=1&IncludeSellers='+userID,{
      headers: {
        'Content-Type': 'application/json',
        "User-Agent": "axios 0.21.1",
        'X-DevKey': process.env.GUNBROKER_DEVKEY,
        'X-AccessToken': token
      },
    })
    .then(async (response) => {
      let listings = []
      let listingsNum = response.data.countReturned; // Total number of listinigs
      let iterations = Math.ceil(listingsNum/300); // Number of times to request results in sets of 300
      for(let i = 1; i <= iterations; i++){
        let token = await GunBrokerAccessToken;
        await axios.get('https://api.gunbroker.com/v1/Items?BuyNowOnly=true&PageSize=300&PageIndex='+i+'&IncludeSellers='+userID,{
          headers: {
            'Content-Type': 'application/json',
            'X-DevKey': process.env.GUNBROKER_DEVKEY,
            'X-AccessToken': token
          },
        }).then((response) => {
          // get item IDs of all listings returned
          
          for(const listing in response.data.results){
            listings.push(response.data.results[listing].itemID);
          }
        }).catch(function (error) {
          console.log(error);
          reject(new Error(error));
        });
      }
      resolve(listings);
    })
    .catch(function (error) {
      console.log(error);
      reject(new Error(error));
    });
  });
}

let LipseyAuthToken = new Promise(function(resolve, reject){
  const login_credentials = { "Email": process.env.LIPSEY_EMAIL, "Password": process.env.LIPSEY_PASSWORD };
  axios.post('https://api.lipseys.com/api/Integration/Authentication/Login', login_credentials,{
    headers: {
      'Content-Type': 'application/json'
    },
  })
  .then(function (response) {
    resolve(response.data.token);
  })
  .catch(function (error) {
    reject(new Error(error));
  });
});

async function getLipseysInventory(){
  return new Promise( async (resolve,reject) => {
    let token = await LipseyAuthToken;
    await axios.get('https://api.lipseys.com/api/Integration/Items/CatalogFeed',{
    headers: {
      Token: token
    },
    })
    .then((response) => {
      let products = [];

      let inventory = response.data.data;

      inventory.map((item) => {
        let product = {};
        product.upc = parseInt(item.upc);
        product.price = item.price;
        product.quantity = item.quantity;
        product.map = item.retailMap;

        products.push(product);
      });

      resolve(products);
    })
    .catch(function (error) {
      console.log(error);
      reject(error);
    });
  });
}

async function getDavidsonsInventoryFile(){
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
      await client.access({
        host: "ftp.davidsonsinventory.com",
        user: process.env.DAVIDSONS_FTP_USERNAME,
        password: process.env.DAVIDSONS_FTP_PASSWORD,
        secure: false
      });
      await client.downloadTo("davidsons_quantity.csv", "davidsons_quantity.csv");
      await client.downloadTo("davidsons_inventory.csv", "davidsons_inventory.csv");
  }
  catch(err) {
      console.log(err);
  }
  console.log(chalk.bold.green("File downloaded."));
  client.close();
}

async function getDavidsonsInventory(){

  await getDavidsonsInventoryFile();

  let DavidsonsInventory = csvToJson.fieldDelimiter(',').getJsonFromCsv('davidsons_quantity.csv');

  let products = [];

  DavidsonsInventory.map((item) => {
    let product = {};
    product.upc = parseInt(item.UPC_Code.replace('#', ''));
    product.quantity = parseInt(item.Quantity_NC.replace("+", "")) + parseInt(item.Quantity_AZ.replace("+", ""));

    products.push(product);
  });

  return products;
}

async function getRSRInventoryFile(){
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
      await client.access({
          host: "rsrgroup.com",
          user: process.env.RSRUSERNAME,
          password: process.env.RSRPASSWORD,
          secure: false
      });
      await client.downloadTo("rsrinventory.txt", "ftpdownloads/rsrinventory-new.txt");

      // Add headers to inventory file
      const InventoryData = fs.readFileSync('rsrinventory.txt')
      const Inventoryfd = fs.openSync('rsrinventory.txt', 'w+')
      const InventoryHeaders = "stockNo;upc;description;dept;manufacturerId;retailPrice;rsrPrice;weight;quantity;model;mfgName;mfgPartNo;status;longDescription;imgName;AK;AL;AR;AZ;CA;CO;CT;DC;DE;FL;GA;HI;IA;ID;IL;IN;KS;KY;LA;MA;MD;ME;MI;MN;MO;MS;MT;NC;ND;NE;NH;NJ;NM;NV;NY;OH;OK;OR;PA;RI;SC;SD;TN;TX;UT;VA;VT;WA;WI;WV;WY;groundShipmentsOnly;adultSigRequired;noDropShip;date;retailMAP;imageDisclaimer;length;width;height;prop65;vendorApprovalRequired\n";
      const InventoryInsert = Buffer.from(InventoryHeaders);
      fs.writeSync(Inventoryfd, InventoryInsert, 0, InventoryInsert.length, 0)
      fs.writeSync(Inventoryfd, InventoryData, 0, InventoryData.length, InventoryInsert.length)
      fs.close(Inventoryfd, (err) => {
        if (err) throw err;
      });
  }
  catch(err) {
      console.log(err);
  }
  console.log(chalk.bold.green("File downloaded and headers added."));
  client.close();
}

async function getRSRInventory(){

  await getRSRInventoryFile();

  let RSRInventory = csvToJson.fieldDelimiter(';').getJsonFromCsv('rsrinventory.txt');

  let products = [];

  RSRInventory.map((item) => {
    let product = {};
    product.upc = parseInt(item.upc);
    product.price = Number(item.rsrPrice);
    product.quantity = parseInt(item.quantity);
    product.map = Number(item.retailMAP);
    product.imageURL = 'https://img.rsrgroup.com/highres-pimages/' + item.imgName;

    products.push(product);
  });

  return products;
}

async function getSSInventory(){
  return new Promise(async (resolve,reject) => {
    await axios.get('http://webservices.theshootingwarehouse.com/smart/inventory.asmx/DailyItemUpdate?CustomerNumber='+process.env.SS_ACCOUNT_NUMBER+'&UserName='+process.env.SS_USERNAME+'&Password='+process.env.SS_PASSWORD+'&Source='+process.env.SS_SOURCE+'&LastUpdate=1/1/1990&LastItem=-1', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        responseType: 'document',
        Accept: 'application/xml'
      }
    }).then(async function (response) {
      let decoded = decodeHtml(response.data);
      let xml = xml2js(decoded, {compact:true, spaces: 2});
      let products = xml.string.NewDataSet.Table;

      let formatted = [];
      for (let item of products) {
        if(parseInt(item.ITYPE._text) == 1 || parseInt(item.ITYPE._text) == 2){
          // Skip if undefined
          if(item.IMODEL._text == undefined){continue}
          if(item.MFGINO._text == undefined){continue}
          //console.log(item);
          let newItem = {};
          newItem.upc = parseInt(item.ITUPC._text);
          newItem.quantity = parseInt(item.QTYOH._text);
          newItem.map = Number(item.MFPRC._text);

          formatted.push(newItem);
        }
      }
      resolve(formatted);
    }).catch(function (error) {
      reject(error);
    });
  });
}

async function getListing(itemNo){
  return new Promise( async (resolve,reject)=>{
    let token = await GunBrokerAccessToken;
    await axios.get('https://api.gunbroker.com/v1/Items/' + itemNo,{
      headers: {
        'Content-Type': 'application/json',
        'X-DevKey': process.env.GUNBROKER_DEVKEY,
        'X-AccessToken': token,
        "User-Agent": "axios 0.21.1"
      },
    }).then((response) => {
      resolve({upc: response.data.upc, price: response.data.buyPrice, quantity: response.data.quantity});
    }).catch((error) => {
      reject(error);
    })
  });
}

async function checkAllListings(){
  // Get every Gunbroker listing item No
  logProcess("Getting all GunBroker listings");
  let listings = await getAllListings();

  // Get every listing from Lipseys, Davidsons, and RSR
  logProcess("Getting Lipseys Inventory");
  let LipseysInventory = await getLipseysInventory();
  logProcess("Getting Davidsons Inventory");
  let DavidsonsInventory = await getDavidsonsInventory();
  logProcess("Getting RSR Inventory");
  let RSRInventory = await getRSRInventory();
  logProcess("Getting Sports South Inventory");
  let SSInventory = await getSSInventory();

  let potentialDeletes = [];

  // Loop through every gunbroker listing
  console.log(chalk.green.bold("Checking " + listings.length + " listings."));
  for(let i = 0; i < listings.length; i++){
    let listing = await getListing(listings[i]).catch((error) => {console.log(error)});

    if(listing){
      let lipseysResults = await LipseysInventory.find(item => item.upc == listing.upc);
      let RSRResults = await RSRInventory.find(item => item.upc == listing.upc);
      let davidsonsResults = await DavidsonsInventory.find(item => item.upc == listing.upc);
      let SSResults = await SSInventory.find(item => item.upc == listing.upc);
      if(lipseysResults == undefined){lipseysResults={};lipseysResults.quantity = 0}
      if(RSRResults == undefined){RSRResults={};RSRResults.quantity = 0}
      if(davidsonsResults == undefined){davidsonsResults={};davidsonsResults.quantity = 0}
      if(SSResults == undefined){SSResults={};SSResults.quantity = 0}

      let totalAvailableQuantity = lipseysResults.quantity + RSRResults.quantity + davidsonsResults.quantity + SSResults.quantity;

      if(listing.quantity > totalAvailableQuantity){
        if(listing.upc){
          potentialDeletes.push(listing.upc);

          console.log(chalk.bold.bgYellow.black("--- Potential Delete ---"));
          console.log(chalk.red.bold(listing.upc + " (" +listing.quantity + " listed)"));
          console.log(chalk.bold.white(lipseysResults.quantity + " listed on Lipseys"));
          console.log(chalk.bold.white(davidsonsResults.quantity + " listed on Davidsons"));
          console.log(chalk.bold.white(RSRResults.quantity + " listed on RSR"));
          console.log(chalk.bold.white(SSResults.quantity + " listed on Sports South"));
        }
      }
    }
  }

  var file = fs.createWriteStream('GunBrokerUPCChecks.txt');
  file.on('error', function(err) { console.log(err) });
  file.write("These UPCs are listed on GunBroker but may not be available (checked Lipseys, Davidsons, and RSR Group)\n");
  potentialDeletes.forEach(function(upc) { file.write(upc + '\n'); });
  file.end();
}

export {logProcess, currentUserID, GunBrokerAccessToken, checkAlreadyPosted, LipseyAuthToken};

// RUN PROCESS

async function postAll(){
  console.log(chalk.green.bold("Posting Lipseys products..."));
  let lispeysPostCount = await postLipseysProducts();
  
  console.log(chalk.green.bold("Posting RSR products..."));
  let RSRPostCount = await postRSRProducts();

  console.log(chalk.green.bold("Posting Davidsons products..."));
  let davidsonsPostCount = await postDavidsonsProducts();

  let totalPosted = lispeysPostCount + davidsonsPostCount + RSRPostCount;

  console.log(chalk.green.bold(totalPosted + " listings posted."));
}

// START
//postAll();
//checkAllListings();
//postSSProducts(1);
fixImages();