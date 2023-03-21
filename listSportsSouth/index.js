import axios from 'axios';
import fs from 'fs';
import * as dotenv from 'dotenv';
import descriptionGenerator from './descriptionGenerator.js';
import { generateImages } from '../imageGenerator.js';
import chalk from 'chalk';
import { logProcess } from '../index.js';
import { GunBrokerAccessToken } from '../index.js';
import { currentUserID } from '../index.js';
import { checkAlreadyPosted  } from '../index.js';
import { xml2js } from 'xml-js';
import decodeHtml from 'decode-html';
import util from 'util';

dotenv.config();

async function getInventory(){
  return new Promise(async (resolve,reject) => {
    await axios.get('http://webservices.theshootingwarehouse.com/smart/inventory.asmx/DailyItemUpdate?CustomerNumber='+process.env.SS_ACCOUNT_NUMBER+'&UserName='+process.env.SS_USERNAME+'&Password='+process.env.SS_PASSWORD+'&Source='+process.env.SS_SOURCE+'&LastUpdate=1/1/1990&LastItem=1', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        responseType: 'document',
        Accept: 'application/xml'
      }
    }).then(function (response) {
      let decoded = decodeHtml(response.data);
      let xml = xml2js(decoded, {compact:true, spaces: 2});
      //console.log(xml.string.NewDataSet.Table);
      resolve(xml.string.NewDataSet.Table);
    }).catch(function (error) {
      //console.log(error);
      reject(error);
    });
  });
}

function formatInventory(data){
  return new Promise(async (resolve,reject) => {

    // Get Manufacturers
    let manufacturers = {};
    await axios.get('http://webservices.theshootingwarehouse.com/smart/inventory.asmx/ManufacturerUpdate?CustomerNumber='+process.env.SS_ACCOUNT_NUMBER+'&UserName='+process.env.SS_USERNAME+'&Password='+process.env.SS_PASSWORD+'&Source=-1', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        responseType: 'document',
        Accept: 'application/xml'
      }
    }).then(function (response) {
      let decoded = decodeHtml(response.data);
      let xml = xml2js(decoded, {compact:true, spaces: 2});
      let manufacturersUnformated = xml.string.NewDataSet.Table;
      manufacturersUnformated.map((item) => {
        manufacturers[item.MFGNO._text] = item.MFGNM._text.trimEnd();
      });
    }).catch(function (error) {
      reject(error);
    });

    // Get Categories
    let categories = {};
    await axios.get('http://webservices.theshootingwarehouse.com/smart/inventory.asmx/CategoryUpdate?CustomerNumber='+process.env.SS_ACCOUNT_NUMBER+'&UserName='+process.env.SS_USERNAME+'&Password='+process.env.SS_PASSWORD+'&Source=-1', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        responseType: 'document',
        Accept: 'application/xml'
      }
    }).then(function (response) {
      let decoded = decodeHtml(response.data);
      let xml = xml2js(decoded, {compact:true, spaces: 2});
      let categoriesUnformated = xml.string.NewDataSet.Table;
      categoriesUnformated.map((item) => {
        categories[item.CATID._text] = item.CATDES._text.trimEnd();
      });
    }).catch(function (error) {
      reject(error);
    });

    let formatted = [];
    data.map( async (item) => {
      if(parseInt(item.ITYPE._text) == 1 || parseInt(item.ITYPE._text) == 2){
        if(categories[item.CATID._text] != 'LOWERS' && categories[item.CATID._text] != 'SPECIALTY'){
          //console.log(item);
          let newItem = {};
          newItem.upc = parseInt(item.ITUPC._text);
          newItem.price = Number(item.CPRC._text);
          newItem.quantity = parseInt(item.QTYOH._text);
          newItem.map = Number(item.MFPRC._text);
          newItem.desc = item.SHDESC._text.trimEnd();
          newItem.type = parseInt(item.ITYPE._text);
          newItem.model = item.IMODEL._text.trimEnd();
          newItem.manufacturer = manufacturers[item.IMFGNO._text];
          newItem.img = "https://media.server.theshootingwarehouse.com/large/"+item.PICREF._text+".jpg";
          newItem.category = await categories[item.CATID._text];
          newItem.mfgPartNumber = item.MFGINO._text.trimEnd();

          // Normalize Categories
          if(newItem.category.trimEnd() == 'RIFLES CENTERFIRE TACTICAL' || newItem.category.trimEnd() == 'RIFLES CENTERFIRE'){
            newItem.category == 'RIFLES';
          }else if(newItem.category.trimEnd() == 'SHOTGUNS TACTICAL'){
            newItem.category == 'SHOTGUNS';
          }

          // Attributes listed differently for pistols vs rifles
          if(parseInt(item.ITYPE._text) == 1){
            // if pistol
            newItem.capacity = item.ITATR5._text.trimEnd();
            newItem.caliber = item.ITATR3._text.trimEnd();
            newItem.action = item.ITATR2._text.trimEnd();
          }else{
            // if long-gun
            newItem.capactiy = item.ITATR4._text.trimEnd();
            newItem.caliber = item.ITATR2._text.trimEnd();
            newItem.action = item.ITATR1._text.trimEnd();
          }

          formatted.push(newItem);
        }
      }
    });

    console.log(formatted);

    let actions = [];
    //console.log(formatted);
    formatted.map((item) => {
      //console.log(item);
      if(!actions.includes(item.action)){
        actions.push(item.action);
      }
    });
    //console.log(actions);
    //resolve(formatted);
  });
}

function filterInventory(inventory){
  logProcess("Filtering Results...");
  let lowestQuantityAllowed = 20;
  let lowestPriceAllowed = 150;
  let highestPriceAllowed = 2000;
  let filtered = [];
  
  inventory.map( async (item) => {
    if(item.quantity >= lowestQuantityAllowed && item.price > lowestPriceAllowed && item.price < highestPriceAllowed && item.upc.length == 12){
      filtered.push(item);
    }
  });
  console.log(inventory.length + " to " + filtered.length);
  return filtered;
}

function postOnGunBroker(item){
  return new Promise( async (resolve, reject) => {

    try{
      let thumbnail = fs.readFileSync('./tmp/thumbnail.jpeg');
      let img1 = fs.readFileSync('./tmp/tmp.jpeg');

      // Setting Quantity
      let quantity;
      
      if(item.Quantity >= 20){ quantity = 1 }else{ quantity = 0 }

      // Setting Price
      let price;
      // Davidsons doesnt provide a MAP price

      let cost = item.price;
      let map = item.map;

      price = cost * 1.15; // set price to cost of gun plus 15% then round to 2 decimals
      price = (Math.round(price * 100) / 100).toFixed(2);

      if(price < map){ // if new price is lower than map, set price to map
        price = map;
      }
      
      // Setting Category IDs and Shipping Prices
      let categoryID;
      let ShippingPrice = 30;

      let categories = ['RIFLES CENTERFIRE TACTICAL','REVOLVERS','RIFLES CENTERFIRE','PISTOLS','SHOTGUNS','SHOTGUNS TACTICAL'];
      

      switch(item.type) {
        case 'Semi-Auto Pistol':
          ShippingPrice = 29;
          categoryID = 3026;
          break;
        case 'Rifle':
          switch (item.action) {
            case 'Semi-Auto':
              categoryID = 3024;
              break;
            case 'Single Shot':
              categoryID = 3011;
              break;
            case 'Pump Action':
              categoryID = 3102;
              break;
            case 'Bolt Action':
              categoryID = 3022;
              break;
            case 'Lever Action':
              categoryID = 3023;
              break;
            default:
              categoryID = 3025;
          }
          break;
        case 'Revolver':
          categoryID = 2325;
          break;
        case 'Shotgun':
          switch (item.action) {
            case 'Semi-Auto':
              categoryID = 3105;
              break;
            case 'Side By Side':
              categoryID = 3104;
              break;
            case 'Over / Under':
              categoryID = 3103;
              break;
            case 'Pump Action':
              categoryID = 3106;
              break;
            default:
              categoryID = 3108;
          }
          break;
        default:
          categoryID = 3004;
      }

      var title = item.Manufacturer + " " + item.ModelSeries + " " + item.Caliber + " " + item.Capacity + " | " + item.UPCCode;

      if(title.length > 75){
        title = item.Manufacturer + " " + item.ModelSeries + " | " + item.UPCCode;
        if(title.length > 75){
          return;
        }
      }

      title = Array.from(new Set(title.split(' '))).toString();
      title = title.replaceAll(",", " ");

      // Prepare listing
      var listingSettings = {
        AutoRelist: 1, // Do not relist
        CanOffer: false, 
        CategoryID: categoryID,
        Characteristics: {
          Manufacturer: item.Manufacturer,
          Model: item.ModelSeries,
          Caliber: item.Caliber,
        },
        Condition: 1, // Factory New
        CountryCode: "US",
        Description: descriptionGenerator(item),
        FixedPrice: price,
        InspectionPeriod: 1, // Sales are final
        isFFLRequired: true,
        ListingDuration: 90, // List for 90 days
        MfgPartNumber: item.ModelSeries,
        PaymentMethods: {
          Check: false,
          VisaMastercard: true,
          COD: false,
          Escrow: false,
          Amex: true,
          PayPal: false,
          Discover: true,
          SeeItemDesc: false,
          CertifiedCheck: false,
          USPSMoneyOrder: true,
          MoneyOrder: true,
          FreedomCoin: false
        },
        PaymentPlan: 0,
        PremiumFeatures: {
          IsFeaturedItem: true,
        },
        PostalCode: "33511",
        Prop65Warning: "Cancer and Reproductive Harm www.P65Warnings.ca.gov",
        Quantity: quantity,
        UseDefaultSalesTax: true,
        ShippingClassesSupported: {
          Overnight: false,
          TwoDay: false,
          ThreeDay: false,
          Ground: true,
          FirstClass: false,
          Priority: false,
          InStorePickup: false,
          AlaskaHawaii: false,
          Other: false
        },
        ShippingClassCosts: { Ground: ShippingPrice },
        StandardTextID: 1138,
        Title: title,
        UPC: item.UPCCode,
        WhoPaysForShipping: 8,
        WillShipInternational: false
      };

      const listingSettingsJSON = JSON.stringify(listingSettings);
      const listingSettingsBlob = new Blob([listingSettingsJSON], {
        type: 'form-data',
      });
      const thumbnailBlob = new Blob([thumbnail], { name: "thumbnail", type: 'image/jpeg', 'Content-Disposition':'form-data' });
      const img1Blob = new Blob([thumbnail], { name: "picture", type: 'image/jpeg', 'Content-Disposition':'form-data' });
      const img2Blob = new Blob([img1], { name: "picture", type: 'image/jpeg', 'Content-Disposition':'form-data' });
      const data = new FormData();
      data.append("data", listingSettingsBlob);
      data.append("thumbnail", thumbnailBlob, 'thumbnail.jpeg');
      data.append("picture", img1Blob, 'picture1.jpeg');
      data.append("picture", img2Blob, 'picture2.jpeg');

      let token = await GunBrokerAccessToken;
      
      await axios.post('https://api.sandbox.gunbroker.com/v1/Items', data, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-DevKey': process.env.GUNBROKER_DEVKEY,
          'X-AccessToken': token
        }
      })
      .then(function (response) {
        logProcess(response.data.userMessage,'good');
      })
      .catch(function (error) {
        console.log(error.response.data);
        reject(error.response.data);
        return;
      });

      resolve();
    }catch(error){
      logProcess(error, 'bad');
      reject(error);
      return;
    }
  });
}

async function postAllListings(listings, limit){
  if(limit && limit < listings.length){
    listings = listings.slice(0, limit);
  }

  logProcess("Posting " + chalk.bold.green(listings.length) + " items on GunBroker.");

  let count = 0;
  let countPosted = 0;

  for(let item of listings){
    count++;

    // Check if item is already posted
    let alreadyPosted = await checkAlreadyPosted(item.UPCCode);
    if(alreadyPosted){
      console.log(chalk.bold.blue.bgWhite(" Davidsons Item "+ count + " / " + listings.length + " ") + chalk.bold.yellow(" ["+item.UPCCode+"] Item already posted."));
    }else{
      await generateImages('https://res.cloudinary.com/davidsons-inc/c_lpad,dpr_2.0,f_auto,h_635,q_100,w_635/v1/media/catalog/product/' + item.itemNo.charAt(0) + "/" + item.itemNo.charAt(1) + "/" + item.itemNo + ".jpg")
      .then( async () => {
        await postOnGunBroker(item, count).catch((error) => console.log(error)).then(() => {
          countPosted++;
          console.log(chalk.bold.blue.bgWhite(" Davidsons Item "+ count + " / " + listings.length + " ") + chalk.bold.green(" [" + item.UPCCode + "] Item (" + item.Manufacturer + " " + item.ModelSeries + ") Posted"));
        });
      })
      .catch((error) => {
        console.log(chalk.bold.red("Image Download Error: "+error));
      });
    }
  }
  console.log(chalk.bold.green("Davidsons postings complete. "+countPosted+" listings posted."));
  return countPosted;
}

async function postSSProducts(){
  let UnformatedInventory = await getInventory();
  let inventory = await formatInventory(UnformatedInventory);
  console.log('done');
  //let filteredInventory = filterInventory(inventory);
  //let countPosted = await postAllListings(filteredInventory);
  //return countPosted;
}

export {postSSProducts};