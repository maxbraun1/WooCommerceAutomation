import axios from 'axios';
import fs from 'fs';
import * as dotenv from 'dotenv';
import descriptionGenerator from './descriptionGenerator.js';
import { generateImages } from '../imageGenerator.js';
import chalk from 'chalk';
import { determineBrand, determineCaliber, logProcess } from '../index.js';
import { checkAlreadyPosted  } from '../index.js';
import { LipseyAuthToken } from '../index.js';
import { WooCommerce } from '../index.js';

dotenv.config();

function getInventory(){
  return new Promise(async (resolve,reject) => {
    let token = await LipseyAuthToken;
    logProcess("Retrieving Lipseys Inventory...");
    await axios.get('https://api.lipseys.com/api/Integration/Items/CatalogFeed', {
      headers: {
        Token: token
      }
    }).then(function (response) {
      resolve(response.data.data);
    }).catch(function (error) {
      reject(error);
    });
  });
}

async function filterInventory(dataset){
  logProcess("Filtering Results...");
  let lowestQuantityAllowed = 20;
  let typesAllowed = ['Semi-Auto Pistol','Rifle', 'Revolver', 'Shotgun'];
  let filtered = [];
  
  await dataset.map( async (item) => {
    if(item.quantity >= lowestQuantityAllowed && typesAllowed.includes(item.type) && item.allocated == false && item.price > 150 && item.upc.toString().length == 12){
      filtered.push(item);
    }
  });
  logProcess(chalk.green.bold(filtered.length) + " products eligable to post (after filter)");
  return filtered;
}

function postOnSEC(item, imageLocation){

  return new Promise( async (resolve, reject) => {

    try{

      // Setting Quantity
      let quantity;

      if(item.quantity >= 50){
        quantity = 10;
      }else if(item.quantity < 50 && item.quantity >= 20){
        quantity = 5;
      }else{
        return;
      }

      // Setting Price
      let price;

      let cost = item.price;
      let map = item.retailMap; // Map will be number, 0 if there is no map

      price = cost * 1.11; // set price to cost of gun plus 11% then round to 2 decimals
      price = (Math.round(price * 100) / 100).toFixed(2);

      if(price < map){ // if new price is lower than map, set price to map
        price = map;
      }

      // if no MSRP is given, set regular price to calculated sale price
      let regPrice;
      if(item.msrp){ regPrice = item.msrp }
      else{ regPrice = price }

      // regular price cant be higher than sale price. If it is, set regular price to sale price
      if(regPrice < price){
        regPrice = price;
      }

      // Setting Attributes
      let attributes = [
        {
          id: 10,
          name: 'Caliber',
          position: 0,
          visible: true,
          variation: false,
          options: [ item.caliberGauge ]
        },
        {
          id: 8,
          name: 'is_firearm',
          position: 1,
          visible: false,
          variation: false,
          options: [ 'YES' ]
        }
      ]
      
      // Setting Category IDs and Shipping Prices
      let categories;
      let ShippingClass = 'firearm';

      switch(item.type) {
        case 'Semi-Auto Pistol':
          ShippingClass = 'handgun-revolver';
          categories = [ { id: 74 }, { id: 79 }, { id: 81 } ];
          break;
        case 'Rifle':
          ShippingClass = 'rifle-shotgun-pistol';
          switch (item.action) {
            case 'Semi-Auto':
              categories = [ { id: 74 }, { id: 78 }, { id: 173 } ];
              break;
            case 'Single Shot':
              categories = [ { id: 74 }, { id: 78 } ];
              break;
            case 'Pump Action':
              categories = [ { id: 74 }, { id: 78 } ];
              break;
            case 'Bolt Action':
              categories = [ { id: 74 }, { id: 78 }, { id: 169 } ];
              break;
            case 'Lever Action':
              categories = [ { id: 74 }, { id: 78 } ];
              break;
            default:
              categories = [ { id: 74 }, { id: 78 }];
          }
          break;
        case 'Revolver':
          ShippingClass = 'handgun-revolver';
          categories = [ { id: 74 }, { id: 79 }, { id: 80 } ];
          break;
        case 'Shotgun':
          ShippingClass = 'rifle-shotgun-pistol';
          categories = [ { id: 74 }, { id: 82 } ];
          break;
        default:
          categories = [ { id: 74 } ];
      }
      
      var title = item.manufacturer + " " + item.model + " " + item.caliberGauge + " " + item.capacity;

      title = Array.from(new Set(title.split(' '))).toString();
      title = title.replaceAll(",", " ");

      // Prepare listing
      var data = {
        name: title,
        status: 'publish',
        description: descriptionGenerator(item),
        sku: item.upc,
        regular_price: regPrice.toString(),
        sale_price: price.toString(),
        date_on_sale_from: null,
        date_on_sale_from_gmt: null,
        date_on_sale_to: null,
        date_on_sale_to_gmt: null,
        on_sale: false,
        manage_stock: true,
        stock_quantity: quantity,
        categories: categories,
        attributes: attributes,
        shipping_class: ShippingClass,
        brands: [await determineBrand(item.manufacturer)],
        tags: [ { name:item.manufacturer }, { name:item.caliberGauge }, { name:item.model }, { name:item.action }, { name:item.type }, { name:item.finish } ],
        images: [
          {
            src: "https://secguns.com/" + imageLocation,
            name: title + " " + item.upc,
            alt: title + " " + item.upc
          },
        ],
        meta_data: [
          {
            key: '_firearm_product',
            value: 'yes'
          },
          {
            key: '_yoast_wpseo_focuskw',
            value: item.manufacturer + " " + item.model + " " + item.upc
          },
          {
            key: '_yoast_wpseo_title',
            value:  title + " " + item.upc
          },
          {
            key: '_yoast_wpseo_metadesc',
            value:  item.manufacturer + " " + item.model + " " + item.upc + " for sale by SEC Guns. " + item.description1
          }
        ]
      };

      await WooCommerce.post('products', data)
      .then(function (response) {
        console.log(chalk.green.bold("Product posted with ID "+response.data.id));
        console.log(response.data.attributes[0].options);
      })
      .catch(function (error) {
        console.log(error);
        reject(error);
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

async function postAllItems(listings, limit){

  logProcess("Posting " + chalk.bold.green(listings.length) + " items on SEC");

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
      console.log(chalk.bold.blue.bgWhite(" Lipseys Item "+ count + " / " + listings.length + " ") + chalk.bold.yellow(" ["+item.upc+"] Item already posted."));
    }else{
      await generateImages("https://www.lipseyscloud.com/images/"+item.imageName, item.upc)
      .then( async (imageLocation) => {
        await postOnSEC(item, imageLocation).catch((error) => console.log(error)).then(() => {
          countPosted++;
          console.log(chalk.bold.blue.bgWhite(" Lipseys Item "+ count + " / " + listings.length + " ") + chalk.bold.green(" [" + item.upc + "] Item (" + item.manufacturer + " " + item.model + ") Posted"));
        });
      })
      .catch((error) => {
        console.log(error);
      });
    }
  }
  console.log(chalk.bold.green("Lipseys postings complete. "+countPosted+" listings posted."));
  return countPosted;
}

async function postLipseysProducts(limit){
  let inventory = await getInventory().catch((error) => console.log(error));
  let filteredInventory = await filterInventory(inventory);
  let countPosted = await postAllItems(filteredInventory, limit);
  return countPosted;
}

export {postLipseysProducts};