import axios from 'axios';
import fs from 'fs';
import * as dotenv from 'dotenv';
import descriptionGenerator from './util/descriptionGenerator.js';
import { generateImages } from './imageGenerator.js';
import chalk from 'chalk';
import * as ftp from 'basic-ftp';
import csvToJson from 'convert-csv-to-json/src/csvToJson.js';
import { logProcess } from './index.js';
import { checkAlreadyPosted  } from './index.js';

dotenv.config();

async function getInventoryFile(){
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
      await client.access({
          host: "ftp.davidsonsinventory.com",
          user: process.env.DAVIDSONS_FTP_USERNAME,
          password: process.env.DAVIDSONS_FTP_PASSWORD,
          secure: false
      });
      await client.downloadTo("files/davidsons_inventory.csv", "davidsons_inventory.csv");
      await client.downloadTo("files/DAV-inventory-with-MAP.txt", "DAV-inventory-with-MAP.txt");
      await client.downloadTo("files/davidsons_quantity.csv", "davidsons_quantity.csv");
  }
  catch(err) {
      console.log(err);
  }
  console.log(chalk.bold.green("Files downloaded."));
  client.close();
}

async function getInventory(){

  await getInventoryFile();

  let revolverExtras = ['Revolver: Single Action','Revolver: Double Action','Revolver: Double Action Only','Revolver: Single|Double'];
  let rifleExtras = ['Rifle: Single Shot','Rifle: Single Action'];
  let pistolExtras = ['Pistol: Derringer','Pistol: Lever Action','Pistol: Bolt Action','Pistol: Single Action'];
  let shotgunMisc = ['Shotgun: Over and Under', 'Shotgun: Over And Under'];
  let shotgunMisc2 = ['Shotgun: Side by Side', 'Shotgun: Side By Side'];

  const data = fs.readFileSync('files/DAV-inventory-with-MAP.txt', 'utf-8');
  const result = String(data).replace(/["]+/g, '');
  fs.writeFileSync('files/DAV-inventory-with-MAP.txt', result, 'utf-8');

  let productMAPs = csvToJson.fieldDelimiter('\t').formatValueByType().getJsonFromCsv('files/DAV-inventory-with-MAP.txt');
  let DavidsonsQuantities = csvToJson.fieldDelimiter(',').getJsonFromCsv('files/davidsons_quantity.csv');

  productMAPs = productMAPs.map((item) => {
    let map;
    let newItem = {};
    if(item['RETAIL-MAP'] == 'N/A'){
      map = 0;
    }else{
      map = Number(item['RETAIL-MAP']);
    }

    newItem.upc = parseInt(item.UPC);
    newItem.map = map;
    return newItem;
  });

  let products = csvToJson.fieldDelimiter(',').getJsonFromCsv('files/davidsons_inventory.csv');

  let items = products.map((item) => {

    if(item.Quantity == 'A*'){
      item.Quantity = 0;
    }else{
      let quantityInfo = DavidsonsQuantities.find(product => parseInt(product.UPC_Code) == parseInt(item.UPCCode.replace('#', '')));
      if(quantityInfo){
        item.Quantity = parseInt(quantityInfo.Quantity_NC.replace("+", "")) + parseInt(quantityInfo.Quantity_AZ.replace("+", ""));
      }else{
        item.Quantity = parseInt(item.Quantity);
      }
    }

    let info = productMAPs.find(product => product.upc == parseInt(item.UPCCode.replace('#', '')));
    let map;
    if(!info){
      map = 0;
    }else{
      map = info.map;
    }

    item.itemNo = item['Item#'];
    item.map = map;
    item.MSP = Number(item.MSP.replace('$', ''));
    item.DealerPrice = Number(item.DealerPrice.replace('$', ''));
    item.RetailPrice = Number(item.RetailPrice.replace('$', ''));
    item.UPCCode = parseInt(item.UPCCode.replace('#', ''));
    item.imageURL = 'https://res.cloudinary.com/davidsons-inc/c_lpad,dpr_2.0,f_auto,h_635,q_100,w_635/v1/media/catalog/product/' + item.itemNo.charAt(0) + "/" + item.itemNo.charAt(1) + "/" + item.itemNo + ".jpg";

    if(revolverExtras.includes(item.GunType)){
      item.GunType = "Revolver";
    }
    if(rifleExtras.includes(item.GunType)){
      item.GunType = "Rifle";
    }
    if(pistolExtras.includes(item.GunType)){
      item.GunType = "Pistol";
    }
    if(shotgunMisc.includes(item.GunType)){
      item.GunType = "Shotgun: Over and Under";
    }
    if(shotgunMisc2.includes(item.GunType)){
      item.GunType = "Shotgun: Side by Side";
    }
    if(item.GunType == "Shotgun: Pump"){
      item.GunType = "Shotgun: Pump Action";
    }

    delete item['Item#'];
    delete item.SalePrice;
    delete item.SaleEnds;

    return item;
  });
  return items;
}

function filterInventory(inventory){
  logProcess("Filtering Results...");
  let lowestQuantityAllowed = 20;
  let lowestPriceAllowed = 150;
  let typesAllowed = ['Pistol: Semi-Auto','Pistol','Rifle: Semi-Auto','Rifle: Bolt Action','Rifle: Lever Action','Rifle: Pump Action','Rifle','Revolver','Shotgun: Pump Action',
  'Shotgun: Over and Under','Shotgun: Semi-Auto','Shotgun: Lever Action','Shotgun: Single Shot','Shotgun: Bolt Action','Shotgun: Side by Side'];
  let filtered = [];
  
  inventory.map( async (item) => {
    if(item.Quantity >= lowestQuantityAllowed && typesAllowed.includes(item.GunType) && item.DealerPrice > lowestPriceAllowed){
      filtered.push(item);
    }
  });
  console.log(inventory.length + " to " + filtered.length);
  return filtered;
}

async function normalizeInventory(dataset){
  let formattedInventory = [];
  dataset.map((item) => {
    let newItem = {};

    newItem.cost = item.DealerPrice;
    newItem.upc = item.UPCCode;
    newItem.imgURL = item.imageURL;
    newItem.map = item.map;
    newItem.desc = item.ItemDescription;
    newItem.quantity = item.Quantity;
    newItem.caliber = item.Caliber;
    newItem.manufacturer = item.Manufacturer;
    newItem.action = item.Action;
    newItem.capacity = item.Capacity;
    newItem.model = item.ModelSeries;

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

function postOnGunBroker(item){
  return new Promise( async (resolve, reject) => {

    try{
      let thumbnail = fs.readFileSync('./tmp/thumbnail.jpeg');
      let img1 = fs.readFileSync('./tmp/tmp.jpeg');

      // Setting Quantity
      let quantity;

      if(item.Quantity >= 50){
        quantity = 5;
      }else if(item.Quantity < 50 && item.Quantity >= 20){
        quantity = 1;
      }else{
        return;
      }

      // Setting Price
      let price;

      let cost = item.DealerPrice;
      let map = item.map; 

      price = cost * 1.11; // set price to cost of gun plus 11% then round to 2 decimals
      price = (Math.round(price * 100) / 100).toFixed(2);

      if(price < map){ // if new price is lower than map, set price to map
        price = map;
      }
      
      // Setting Category IDs and Shipping Prices
      let categoryID;
      let ShippingPrice = 30;

      switch(item.GunType) {
        case 'Pistol: Semi-Auto':
          ShippingPrice = 29;
          categoryID = 3026;
          break;
        case 'Pistol':
          ShippingPrice = 29;
          categoryID = 3027;
          break;
        case 'Rifle: Semi-Auto':
          categoryID = 3024;
          break;
        case 'Rifle: Bolt Action':
          categoryID = 3022;
          break;
        case 'Rifle: Lever Action':
          categoryID = 3023;
          break;
        case 'Rifle: Pump Action':
          categoryID = 3102;
          break;
        case 'Rifle':
          categoryID = 3025;
          break;
        case 'Revolver':
          ShippingPrice = 29;
          categoryID = 2325;
          break;
        case 'Shotgun: Pump Action':
          categoryID = 3106;
          break;
        case 'Shotgun: Over and Under':
          categoryID = 3103;
          break;
        case 'Shotgun: Semi-Auto':
          categoryID = 3105;
          break;
        case 'Shotgun: Lever Action':
          categoryID = 3113;
          break;
        case 'Shotgun: Single Shot':
          categoryID = 3107;
          break;
        case 'Shotgun: Bolt Action':
          categoryID = 3112;
          break;
        case 'Shotgun: Side by Side':
          categoryID = 3104;
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
        SKU: 'DAV',
        StandardTextID: 4713,
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
  /*if(limit && limit < listings.length){
    listings = listings.slice(0, limit);
  }*/

  logProcess("Posting " + chalk.bold.green(listings.length) + " items on GunBroker.");

  let count = 0;
  let countPosted = 0;

  for(let item of listings){
    count++;

    if(countPosted >= limit){
      return;
    }

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

async function postDavidsonsProducts(limit){
  let inventory = await getInventory();
  let filteredInventory = filterInventory(inventory);
  let normalizedInventory = normalizeInventory(filteredInventory);
  //let countPosted = await postAllListings(filteredInventory, limit);
  //return countPosted;
}

export {postDavidsonsProducts};