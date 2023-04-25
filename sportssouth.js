import axios from 'axios';
import fs from 'fs';
import * as dotenv from 'dotenv';
import descriptionGenerator from './util/descriptionGenerator.js';
import { generateImages } from './imageGenerator.js';
import chalk from 'chalk';
import { logProcess } from './index.js';
import { checkAlreadyPosted  } from './index.js';
import { xml2js } from 'xml-js';
import decodeHtml from 'decode-html';

dotenv.config();

async function getInventory(){
  return new Promise(async (resolve,reject) => {
    await axios.get('http://webservices.theshootingwarehouse.com/smart/inventory.asmx/DailyItemUpdate?CustomerNumber='+process.env.SS_ACCOUNT_NUMBER+'&UserName='+process.env.SS_USERNAME+'&Password='+process.env.SS_PASSWORD+'&Source='+process.env.SS_SOURCE+'&LastUpdate=1/1/1990&LastItem=-1', {
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

function organizeInventory(data){
  return new Promise(async (resolve,reject) => {
    console.log("Formatting "+data.length+" products");
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
    for (let item of data) {
      if(parseInt(item.ITYPE._text) == 1 || parseInt(item.ITYPE._text) == 2){
        if(await categories[item.CATID._text] != 'LOWERS' && await categories[item.CATID._text] != 'SPECIALTY'){
          // Skip if undefined
          if(typeof item.IMODEL._text === "undefined"){continue}
          if(typeof item.MFGINO._text === "undefined"){continue}
          //console.log(item);
          let newItem = {};
          newItem.upc = parseInt(item.ITUPC._text);
          newItem.price = Number(item.CPRC._text);
          newItem.quantity = parseInt(item.QTYOH._text);
          newItem.map = Number(item.MFPRC._text);
          newItem.desc = item.SHDESC._text.trimEnd();
          newItem.type = parseInt(item.ITYPE._text);
          newItem.model = item.IMODEL._text.trimEnd();
          newItem.manufacturer = await manufacturers[item.IMFGNO._text];
          newItem.img = "https://media.server.theshootingwarehouse.com/large/"+item.PICREF._text+".jpg";
          newItem.category = await categories[item.CATID._text];
          newItem.mfgPartNumber = item.MFGINO._text.trimEnd();
          newItem.series = item.SERIES._text ? item.SERIES._text.trimEnd() : undefined;

          // Normalize Categories
          if(newItem.category.trimEnd() == 'RIFLES CENTERFIRE TACTICAL' || newItem.category.trimEnd() == 'RIFLES CENTERFIRE'){
            newItem.category == 'RIFLES';
          }else if(newItem.category.trimEnd() == 'SHOTGUNS TACTICAL'){
            newItem.category == 'SHOTGUNS';
          }

          // Attributes listed differently for pistols vs rifles
          if(parseInt(item.ITYPE._text) == 1){
            // if pistol

            if(typeof item.ITATR5._text === "undefined"){continue}
            if(typeof item.ITATR3._text === "undefined"){continue}
            if(typeof item.ITATR2._text === "undefined"){continue}

            newItem.capacity = item.ITATR5._text.trimEnd();
            newItem.caliber = item.ITATR3._text.trimEnd();
            newItem.action = item.ITATR2._text.trimEnd();
          }else{
            // if long-gun

            if(typeof item.ITATR4._text === "undefined"){continue}
            if(typeof item.ITATR2._text === "undefined"){continue}
            if(typeof item.ITATR1._text === "undefined"){continue}

            newItem.capactiy = item.ITATR4._text.trimEnd();
            newItem.caliber = item.ITATR2._text.trimEnd();
            newItem.action = item.ITATR1._text.trimEnd();
          }

          formatted.push(newItem);
        }
      }
    }
    resolve(formatted);
  });
}

function filterInventory(inventory){
  logProcess("Filtering Results...");
  let lowestQuantityAllowed = 20;
  let lowestPriceAllowed = 150;
  let highestPriceAllowed = 2000;
  let filtered = [];
  
  inventory.map( async (item) => {
    if(item.quantity >= lowestQuantityAllowed && item.price > lowestPriceAllowed && item.price < highestPriceAllowed && item.upc.toString().length == 12 && item.caliber && item.capacity){
      filtered.push(item);
    }
  });
  console.log(inventory.length + " to " + filtered.length);
  console.log(filtered);
  return filtered;
}

async function normalizeInventory(dataset){
  let formattedInventory = [];
  dataset.map((item) => {
    let newItem = {};

    newItem.cost = item.price;
    newItem.upc = item.upc;
    newItem.imgURL = item.img;
    newItem.map = item.map;
    newItem.desc = item.desc;
    newItem.quantity = item.quantity;
    newItem.caliber = item.caliber;
    newItem.manufacturer = item.manufacturer.toLowerCase();
    newItem.action = item.action;
    newItem.capacity = item.capacity;
    newItem.model = item.model;

    newItem.extra = {
      oal: ["Overall Length", item.OverallLength],
      finish: ["Finish", item.Finish],
      sights: ["Sights", item.Sights],
      barrelLength: ["Barrel Length", item.BarrelLength]
    };

    formattedInventory.push(newItem);
  });

  console.log(formattedInventory);
  return formattedInventory;
}

function findCategory(category, action){
  let categories;
  let shippingClass = 'firearm';
  switch(category) {
    case 'SHOTGUNS':
      shippingClass = 'rifle-shotgun-pistol';
      categories = [ { id: 74 }, { id: 82 } ];
      break;
    case 'PISTOLS':
      shippingClass = 'handgun-revolver';
      categories = [ { id: 74 }, { id: 79 }, { id: 81 } ];
      break;
    case 'RIFLES':
      shippingClass = 'rifle-shotgun-pistol';
      switch (action) {
        case 'Semi-Auto':
          categories = [ { id: 74 }, { id: 78 }, { id: 173 } ];
          break;
        case 'Bolt':
          categories = [ { id: 74 }, { id: 78 }, { id: 169 } ];
          break;
        default:
          categories = [ { id: 74 }, { id: 78 } ];
          break;
      }
      break;
    case 'REVOLVERS':
      shippingClass = 'handgun-revolver';
      categories = [ { id: 74 }, { id: 79 }, { id: 80 } ];
      break;
    default:
      categories = [ { id: 74 } ];
  }
  
  return { categories: categories, shippingClass: shippingClass }
}

function postOnGunBroker(item){
  return new Promise( async (resolve, reject) => {

    try{
      let thumbnail = fs.readFileSync('./tmp/thumbnail.jpeg');
      let img1 = fs.readFileSync('./tmp/tmp.jpeg');

      // Setting Quantity
      let quantity;
      
      if(item.quantity >= 20){ quantity = 1 }else{ quantity = 0 }

      // Setting Price
      let price;

      let cost = item.price;
      let map = item.map;

      price = cost * 1.11; // set price to cost of gun plus 11% then round to 2 decimals
      price = (Math.round(price * 100) / 100).toFixed(2);

      if(price < map){ // if new price is lower than map, set price to map
        price = map;
      }
      
      // Setting Category IDs and Shipping Prices
      let categoryID;
      let ShippingPrice = 30;
      

      switch(item.type) {
        case 'SHOTGUNS':
          switch (item.action) {
            case 'Semi-Auto':
              categoryID = 3105;
              break;
            case 'Lever':
              categoryID = 3113;
              break;
            case 'Bolt':
              categoryID = 3112;
              break;
            case 'Break Open':
              categoryID = 3104;
              break;
            case 'Pump':
              categoryID = 3106;
              break;
            default:
              categoryID = 3108;
          }
          break;
        case 'PISTOLS':
          switch (item.action) {
            case 'Semi-Auto':
              categoryID = 3026;
              ShippingPrice = 29;
              break;
            case 'Striker Fire':
              categoryID = 3026;
              ShippingPrice = 29;
              break;
            case 'SA/DA':
              categoryID = 3026;
              ShippingPrice = 29;
              break;
            case 'DAO':
              categoryID = 3026;
              ShippingPrice = 29;
              break;
            case 'DA/SA':
              categoryID = 3026;
              ShippingPrice = 29;
              break;
            case 'SAO':
              categoryID = 3026;
              ShippingPrice = 29;
              break;
            case 'Bolt':
              categoryID = 3101;
              ShippingPrice = 29;
              break;
            default:
              categoryID = 3027;
              ShippingPrice = 29;
          }
          break;
        case 'RIFLES':
          switch (item.action) {
            case 'Semi-Auto':
              categoryID = 3024;
              break;
            case 'Bolt':
              categoryID = 3022;
              break;
            case 'Lever':
              categoryID = 3023;
              break;
            case 'Pump':
              categoryID = 3106;
              break;
            default:
              categoryID = 3025;
          }
          break;
        case 'REVOLVERS':
          categoryID = 2325;
          break;
        default:
          categoryID = 4032;
      }

      var title = item.manufacturer + " " + item.model + " " + item.caliber + " " + item.capacity + " | " + item.upc;

      if(title.length > 75){
        title = item.manufacturer + " " + item.model + " | " + item.upc;
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
          Manufacturer: item.manufacturer,
          Model: item.model,
          Caliber: item.caliber,
        },
        Condition: 1, // Factory New
        CountryCode: "US",
        Description: descriptionGenerator(item),
        FixedPrice: price,
        InspectionPeriod: 1, // Sales are final
        isFFLRequired: true,
        ListingDuration: 90, // List for 90 days
        MfgPartNumber: item.mfgPartNumber,
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
        SKU: 'SS',
        StandardTextID: 4713,
        Title: title,
        UPC: item.upc,
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
      
      await axios.post('https://api.gunbroker.com/v1/Items', data, {
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

  logProcess("Posting " + chalk.bold.green(listings.length) + " items on GunBroker.");

  let count = 0;
  let countPosted = 0;

  for(let item of listings){
    count++;

    if(countPosted >= limit){
      return;
    }

    // Check if item is already posted
    let alreadyPosted = await checkAlreadyPosted(item.upc);
    if(alreadyPosted){
      console.log(chalk.bold.blue.bgWhite(" Sports South Item "+ count + " / " + listings.length + " ") + chalk.bold.yellow(" ["+item.upc+"] Item already posted."));
    }else{
      await generateImages(item.img)
      .then( async () => {
        await postOnGunBroker(item, count).catch((error) => console.log(error)).then(() => {
          countPosted++;
          console.log(chalk.bold.blue.bgWhite(" Sports South Item "+ count + " / " + listings.length + " ") + chalk.bold.green(" [" + item.upc + "] Item (" + item.manufacturer + " " + item.model + ") Posted"));
        });
      })
      .catch((error) => {
        console.log(error);
      });
    }
  }
  console.log(chalk.bold.green("Sports South postings complete. "+countPosted+" listings posted."));
  return countPosted;
}

async function postSSProducts(limit){
  let unorganizedInventory = await getInventory();
  let inventory = await organizeInventory(unorganizedInventory);
  let filteredInventory = await filterInventory(inventory);
  let normalizedInventory = await normalizeInventory(filteredInventory);
  console.log(normalizedInventory);

  /*
  let countPosted = await postAllListings(filteredInventory, limit);
  return countPosted;
  */
}

export {postSSProducts};