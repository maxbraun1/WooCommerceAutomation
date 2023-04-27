import axios from "axios";
import fs from "fs";
import * as dotenv from "dotenv";
import descriptionGenerator from "./util/descriptionGenerator.js";
import { generateImages } from "./imageGenerator.js";
import chalk from "chalk";
import { logProcess } from "./index.js";
import { checkAlreadyPosted } from "./index.js";
import { LipseyAuthToken } from "./index.js";
import pkg from "@woocommerce/woocommerce-rest-api";
const WooCommerceRestApi = pkg.default;

dotenv.config();

const WooCommerce = new WooCommerceRestApi({
  url: "https://secguns.com",
  consumerKey: process.env.SEC_KEY,
  consumerSecret: process.env.SEC_SECRET,
  version: "wc/v3",
});

import {
  generateAttributes,
  generatePrices,
  generateQuantity,
  generateTitle,
} from "./util/util.js";

dotenv.config();

function getInventory() {
  return new Promise(async (resolve, reject) => {
    let token = await LipseyAuthToken;
    await axios
      .get("https://api.lipseys.com/api/Integration/Items/CatalogFeed", {
        headers: {
          Token: token,
        },
      })
      .then(function (response) {
        resolve(response.data.data);
      })
      .catch(function (error) {
        reject(error);
      });
  });
}

async function filterInventory(dataset) {
  let lowestQuantityAllowed = 20;
  let typesAllowed = ["Semi-Auto Pistol", "Rifle", "Revolver", "Shotgun"];
  let filtered = [];

  await dataset.map(async (item) => {
    if (
      item.quantity >= lowestQuantityAllowed &&
      typesAllowed.includes(item.type) &&
      item.allocated == false &&
      item.price > 150 &&
      item.upc.toString().length == 12
    ) {
      filtered.push(item);
    }
  });
  return filtered;
}

async function normalizeInventory(dataset) {
  let formattedInventory = [];
  dataset.map((item) => {
    let cat = findCategory(item.type, item.action);
    let newItem = {};

    newItem.cost = item.price;
    newItem.msrp = item.msrp;
    newItem.upc = item.upc;
    newItem.imgURL = "https://www.lipseyscloud.com/images/" + item.imageName;
    newItem.map = item.retailMap;
    newItem.desc = item.description1;
    newItem.quantity = item.quantity;
    newItem.caliber = item.caliberGauge;
    newItem.manufacturer = item.manufacturer;
    newItem.action = item.action;
    newItem.capacity = item.capacity;
    newItem.model = item.model;
    newItem.categories = cat.categories;
    newItem.shippingClass = cat.shippingClass;
    newItem.from = "LIP";

    newItem.extra = [
      ["Overall Length", item.overallLength],
      ["Finish", item.finish],
      ["Sights", item.sightsType],
      ["Barrel Length", item.barrelLength],
    ];

    formattedInventory.push(newItem);
  });
  return formattedInventory;
}

function findCategory(type, action) {
  // Setting Category IDs and Shipping Class
  let categories;
  let shippingClass = "firearm";

  switch (type) {
    case "Semi-Auto Pistol":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "Rifle":
      shippingClass = "rifle-shotgun-pistol";
      switch (action) {
        case "Semi-Auto":
          categories = [{ id: 74 }, { id: 78 }, { id: 173 }];
          break;
        case "Single Shot":
          categories = [{ id: 74 }, { id: 78 }];
          break;
        case "Pump Action":
          categories = [{ id: 74 }, { id: 78 }];
          break;
        case "Bolt Action":
          categories = [{ id: 74 }, { id: 78 }, { id: 169 }];
          break;
        case "Lever Action":
          categories = [{ id: 74 }, { id: 78 }];
          break;
        default:
          categories = [{ id: 74 }, { id: 78 }];
      }
      break;
    case "Revolver":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 80 }];
      break;
    case "Shotgun":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 82 }];
      break;
    default:
      categories = [{ id: 74 }];
  }
  return { categories: categories, shippingClass: shippingClass };
}

function postOnSEC(item, imageLocation) {
  return new Promise(async (resolve, reject) => {
    try {
      let prices = generatePrices(item);
      let title = generateTitle(item);

      // Prepare listing data
      var data = {
        name: title,
        status: "publish",
        description: descriptionGenerator(item),
        sku: item.upc,
        regular_price: prices.regPrice.toString(),
        sale_price: prices.salePrice.toString(),
        date_on_sale_from: null,
        date_on_sale_from_gmt: null,
        date_on_sale_to: null,
        date_on_sale_to_gmt: null,
        on_sale: false,
        manage_stock: true,
        stock_quantity: generateQuantity(item),
        categories: item.categories,
        attributes: generateAttributes(item),
        shipping_class: item.shippingClass,
        brands: [await determineBrand(item.manufacturer)],
        tags: [
          { name: item.manufacturer },
          { name: item.caliber },
          { name: item.model },
          { name: item.action },
          { name: "ap" },
        ],
        images: [
          {
            src: "https://secguns.com/" + imageLocation,
            name: title + " " + item.upc,
            alt: title + " " + item.upc,
          },
        ],
        meta_data: [
          {
            key: "_firearm_product",
            value: "yes",
          },
          {
            key: "_yoast_wpseo_focuskw",
            value: item.manufacturer + " " + item.model + " " + item.upc,
          },
          {
            key: "_yoast_wpseo_title",
            value: title + " " + item.upc,
          },
          {
            key: "_yoast_wpseo_metadesc",
            value:
              item.manufacturer +
              " " +
              item.model +
              " " +
              item.upc +
              " for sale by SEC Guns. " +
              item.description1,
          },
        ],
      };

      await WooCommerce.post("products", data)
        .then(function (response) {
          console.log(
            chalk.green.bold("Product posted with ID " + response.data.id)
          );
          console.log(response.data.attributes[0].options);
        })
        .catch(function (error) {
          console.log(error);
          reject(error);
          return;
        });

      resolve();
    } catch (error) {
      logProcess(error, "bad");
      reject(error);
      return;
    }
  });
}

async function postAllItems(listings, limit) {
  logProcess("Posting " + chalk.bold.green(listings.length) + " items on SEC");

  let count = 0;
  let countPosted = 0;

  for (let item of listings) {
    count++;

    if (countPosted >= limit) {
      return;
    }

    // Check if item is already posted
    let alreadyPosted = await checkAlreadyPosted(item.upc);
    if (alreadyPosted) {
      console.log(
        chalk.bold.blue.bgWhite(
          " Lipseys Item " + count + " / " + listings.length + " "
        ) + chalk.bold.yellow(" [" + item.upc + "] Item already posted.")
      );
      await updateQuantity(item);
    } else {
      await generateImages(
        "https://www.lipseyscloud.com/images/" + item.imageName,
        item.upc
      )
        .then(async (imageLocation) => {
          await postOnSEC(item, imageLocation)
            .catch((error) => console.log(error))
            .then(() => {
              countPosted++;
              console.log(
                chalk.bold.blue.bgWhite(
                  " Lipseys Item " + count + " / " + listings.length + " "
                ) +
                  chalk.bold.green(
                    " [" +
                      item.upc +
                      "] Item (" +
                      item.manufacturer +
                      " " +
                      item.model +
                      ") Posted"
                  )
              );
            });
        })
        .catch((error) => {
          console.log(error);
        });
    }
  }
  console.log(
    chalk.bold.green(
      "Lipseys postings complete. " + countPosted + " listings posted."
    )
  );
  return countPosted;
}

async function prepLipseysInventory() {
  let inventory = await getInventory().catch((error) => console.log(error));
  let filteredInventory = await filterInventory(inventory);
  let normalizedInventory = await normalizeInventory(filteredInventory);
  return normalizedInventory;
}

export { prepLipseysInventory };
