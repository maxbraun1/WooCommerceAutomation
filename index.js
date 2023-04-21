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
import stringSimilarity from 'string-similarity';
import pkg from '@woocommerce/woocommerce-rest-api';
import SFTPClient from 'ssh2-sftp-client';
const WooCommerceRestApi = pkg.default;

dotenv.config();

export const WooCommerce = new WooCommerceRestApi({
  url: 'https://secguns.com',
  consumerKey: process.env.SEC_KEY,
  consumerSecret: process.env.SEC_SECRET,
  version: "wc/v3"
});

let client = new SFTPClient();
await client.connect({
  host: "secgunsdev.sftp.wpengine.com",
  port: '2222',
  user: process.env.SEC_FTP_USER,
  password: process.env.SEC_FTP_PASS
});

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

// Brand
let brands = [{name: "", id: null}];

async function getBrands(){
  // Gets all brands from SEC and returns as array of objects {name:[name], id:[id]}
  await axios.get('https://secguns.com/wp-json/wc/v2/products/brands?per_page=100',{
    auth: {
      username: process.env.SEC_WORDPRESS_USER,
      password: process.env.SEC_WORDPRESS_PASS
    },
  })
  .then(async function (response) {
    let pages = response.headers['x-wp-totalpages'];
    let brandList = [];
    for(let x = 0; x < pages; x++){
      let offset = (x * 100);
      await axios.get('https://secguns.com/wp-json/wc/v2/products/brands?per_page=100&offset=' + offset,{
        auth: {
          username: process.env.SEC_WORDPRESS_USER,
          password: process.env.SEC_WORDPRESS_PASS
        },
      })
      .then(async function (response) {
        await response.data.map((item) => {
          let newBrand = {};
          newBrand.name = item.name;
          newBrand.id = item.id;
    
          brandList.push(newBrand);
        });
      }).catch(function (error) {
        console.log(error);
      });
    }
    brands.push(...brandList);
  })
  .catch(function (error) {
    console.log(error);
  });
};

await getBrands();

async function determineBrand(brand){
  let brandNames = brands.map((item) => {return item.name.toLowerCase().replace("&amp;", "&")});
  let match = stringSimilarity.findBestMatch(brand.toLowerCase(), brandNames);
  let bestMatch = brands.find(item => item.name.toLowerCase().replace("&amp;", "&") === match.bestMatch.target);
  
  console.log("given '"+brand+"' found best match '"+bestMatch.name+"' with rating: "+match.bestMatch.rating);
  if(match.bestMatch.rating >= 0.85){
    return bestMatch.id;
  }
  // Brand doesn't exist, create brand
  const data = {
    name: brand,
  };
  
  return await WooCommerce.post("products/brands", data)
  .then((response) => {
    console.log(chalk.bold.yellow("New Brand created: " + response.data.name));
    brands.push({name: brand, id: response.data.id});
    return response.data.id;
  })
  .catch((error) => {
    console.log(error.data);
    return null;
  });
}

// Caliber
let calibers = new Promise(async function(resolve, reject){ // Gets all calibers from SEC and returns as array of objects {name:[name], id:[id]}
  WooCommerce.get("products/attributes/10/terms?per_page=100")
  .then(async function (response) {
    let pages = response.headers['x-wp-totalpages'];
    let caliberList = [];
    for(let x = 0; x < pages; x++){
      let offset = (x * 100);
      await WooCommerce.get("products/attributes/10/terms?per_page=100&offset=" + offset)
      .then(function (response) {
        response.data.map((item) => {
          let newCaliber = {};
          newCaliber.name = item.name;
          newCaliber.id = item.id;
    
          caliberList.push(newCaliber);
        });
      }).catch(function (error) {
        console.log(error);
        reject(new Error(error));
      });
    }
    resolve(caliberList);
  })
  .catch(function (error) {
    console.log(error);
    reject(new Error(error));
  });
});

async function determineCaliber(caliber){
  let caliberList = await calibers;
  if(caliberList.length < 1){
    return caliber;
  }else{
    let caliberNames = caliberList.map((item) => {return item.name});
    let match = stringSimilarity.findBestMatch(caliber, caliberNames);
    let bestMatch = caliberList.find(item => item.name === match.bestMatch.target);
    if(match.bestMatch.rating >= 0.85){
      console.log("Given '"+caliber+"', found '"+bestMatch.name+"' with "+match.bestMatch.rating*100+"% similarity.");
      return bestMatch.name;
    }else{
      return caliber;
    }
  }
}

function checkAlreadyPosted(upc){
  return new Promise( async (resolve, reject) => {
    WooCommerce.get("products/?sku=" + upc)
    .then((response) => {
      if(response.data.length > 0){
        resolve(true);
      }else{
        resolve(false);
      }
      //console.log(response.data);
    })
    .catch((error) => {
      console.log(error.response.data);
    });
  });
}

function getAllListings(){
  return new Promise((resolve,reject) => {
    WooCommerce.get("products?per_page=100")
  .then(async function (response) {
    let pages = response.headers['x-wp-totalpages'];
    let listings = [];
    for(let x = 0; x < pages; x++){
      let offset = (x * 100);
      await WooCommerce.get("products?per_page=100&offset=" + offset)
      .then(function (response) {
        response.data.map((item) => {
          let newListing = {};
          newListing.id = item.id;
          newListing.upc = parseInt(item.sku);
          newListing.quantity = item.stock_quantity;
    
          listings.push(newListing);
        });
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

async function updateListing(listing, quantityAvailable){

}

async function checkAllListings(){
  // Get every SEC listing item No
  logProcess("Getting all SEC Guns listings");
  let listings = await getAllListings();

  // Get every listing from Lipseys, Davidsons, RSR, and SportsSouth
  logProcess("Getting Lipseys Inventory");
  let LipseysInventory = await getLipseysInventory();
  logProcess("Getting Davidsons Inventory");
  let DavidsonsInventory = await getDavidsonsInventory();
  logProcess("Getting RSR Inventory");
  let RSRInventory = await getRSRInventory();
  logProcess("Getting Sports South Inventory");
  let SSInventory = await getSSInventory();

  let potentialDeletes = [];

  // Loop through every SEC Guns listing
  console.log(chalk.green.bold("Checking " + listings.length + " listings."));
  for(let i = 0; i < listings.length; i++){
    let listing = listings[i];

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

      console.log("SEC Quantity", listing.quantity);
      console.log("Vendors Quantity", totalAvailableQuantity);
      console.log("--------------------------------------------------------")

      if(listing.quantity > (totalAvailableQuantity - 10)){
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
  file.write("These UPCs are listed on SEC Guns but may not be available (checked Lipseys, Davidsons, and RSR Group)\n");
  potentialDeletes.forEach(function(upc) { file.write(upc + '\n'); });
  file.end();
}

export {logProcess, checkAlreadyPosted, LipseyAuthToken, determineBrand, determineCaliber, client};

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
//postSSProducts();
postLipseysProducts();
//postDavidsonsProducts(0);