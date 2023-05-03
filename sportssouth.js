import axios from "axios";
import * as dotenv from "dotenv";
import { xml2js } from "xml-js";
import decodeHtml from "decode-html";

dotenv.config();

async function getInventory() {
  return new Promise(async (resolve, reject) => {
    await axios
      .get(
        "http://webservices.theshootingwarehouse.com/smart/inventory.asmx/DailyItemUpdate?CustomerNumber=" +
          process.env.SS_ACCOUNT_NUMBER +
          "&UserName=" +
          process.env.SS_USERNAME +
          "&Password=" +
          process.env.SS_PASSWORD +
          "&Source=" +
          process.env.SS_SOURCE +
          "&LastUpdate=1/1/1990&LastItem=-1",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            responseType: "document",
            Accept: "application/xml",
          },
        }
      )
      .then(function (response) {
        let decoded = decodeHtml(response.data);
        let xml = xml2js(decoded, { compact: true, spaces: 2 });
        resolve(xml.string.NewDataSet.Table);
      })
      .catch(function (error) {
        reject(error);
      });
  });
}

function organizeInventory(data) {
  return new Promise(async (resolve, reject) => {
    // Get Manufacturers
    let manufacturers = {};
    await axios
      .get(
        "http://webservices.theshootingwarehouse.com/smart/inventory.asmx/ManufacturerUpdate?CustomerNumber=" +
          process.env.SS_ACCOUNT_NUMBER +
          "&UserName=" +
          process.env.SS_USERNAME +
          "&Password=" +
          process.env.SS_PASSWORD +
          "&Source=-1",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            responseType: "document",
            Accept: "application/xml",
          },
        }
      )
      .then(function (response) {
        let decoded = decodeHtml(response.data);
        let xml = xml2js(decoded, { compact: true, spaces: 2 });
        let manufacturersUnformated = xml.string.NewDataSet.Table;
        manufacturersUnformated.map((item) => {
          manufacturers[item.MFGNO._text] = item.MFGNM._text.trimEnd();
        });
      })
      .catch(function (error) {
        reject(error);
      });

    // Get Categories
    let categories = {};
    await axios
      .get(
        "http://webservices.theshootingwarehouse.com/smart/inventory.asmx/CategoryUpdate?CustomerNumber=" +
          process.env.SS_ACCOUNT_NUMBER +
          "&UserName=" +
          process.env.SS_USERNAME +
          "&Password=" +
          process.env.SS_PASSWORD +
          "&Source=-1",
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            responseType: "document",
            Accept: "application/xml",
          },
        }
      )
      .then(function (response) {
        let decoded = decodeHtml(response.data);
        let xml = xml2js(decoded, { compact: true, spaces: 2 });
        let categoriesUnformated = xml.string.NewDataSet.Table;
        categoriesUnformated.map((item) => {
          categories[item.CATID._text] = item.CATDES._text.trimEnd();
        });
      })
      .catch(function (error) {
        reject(error);
      });

    let formatted = [];
    for (let item of data) {
      if (parseInt(item.ITYPE._text) == 1 || parseInt(item.ITYPE._text) == 2) {
        if ((await categories[item.CATID._text]) != "LOWERS" && (await categories[item.CATID._text]) != "SPECIALTY") {
          // Skip if undefined
          if (typeof item.IMODEL._text === "undefined") {
            continue;
          }
          if (typeof item.MFGINO._text === "undefined") {
            continue;
          }
          //console.log(item);
          let newItem = {};
          newItem.upc = item.ITUPC._text;
          newItem.price = Number(item.CPRC._text);
          newItem.quantity = parseInt(item.QTYOH._text);
          newItem.map = Number(item.MFPRC._text);
          newItem.desc = item.SHDESC._text.trimEnd();
          newItem.type = parseInt(item.ITYPE._text);
          newItem.model = item.IMODEL._text.trimEnd();
          newItem.manufacturer = await manufacturers[item.IMFGNO._text];
          newItem.img = "https://media.server.theshootingwarehouse.com/large/" + item.PICREF._text + ".jpg";
          newItem.category = await categories[item.CATID._text];
          newItem.mfgPartNumber = item.MFGINO._text.trimEnd();
          newItem.series = item.SERIES._text ? item.SERIES._text.trimEnd() : undefined;

          // Normalize Categories
          if (
            newItem.category.trimEnd() == "RIFLES CENTERFIRE TACTICAL" ||
            newItem.category.trimEnd() == "RIFLES CENTERFIRE"
          ) {
            newItem.category == "RIFLES";
          } else if (newItem.category.trimEnd() == "SHOTGUNS TACTICAL") {
            newItem.category == "SHOTGUNS";
          }

          // Attributes listed differently for pistols vs rifles
          if (parseInt(item.ITYPE._text) == 1) {
            // if pistol

            if (typeof item.ITATR5._text === "undefined") {
              continue;
            }
            if (typeof item.ITATR3._text === "undefined") {
              continue;
            }
            if (typeof item.ITATR2._text === "undefined") {
              continue;
            }

            newItem.capacity = item.ITATR5._text.trimEnd();
            newItem.caliber = item.ITATR3._text.trimEnd();
            newItem.action = item.ITATR2._text.trimEnd();
          } else {
            // if long-gun

            if (typeof item.ITATR4._text === "undefined") {
              continue;
            }
            if (typeof item.ITATR2._text === "undefined") {
              continue;
            }
            if (typeof item.ITATR1._text === "undefined") {
              continue;
            }

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

function minimizeInventory(inventory) {
  let minimized = [];

  inventory.map((item) => {
    let min = {};
    min.upc = item.upc.toString();
    min.cost = item.price;
    min.quantity = item.quantity;

    minimized.push(min);
  });

  return minimized;
}

function filterInventory(inventory) {
  let lowestQuantityAllowed = 20;
  let lowestPriceAllowed = 150;
  let highestPriceAllowed = 2000;
  let filtered = [];

  inventory.map(async (item) => {
    if (
      item.quantity >= lowestQuantityAllowed &&
      item.price > lowestPriceAllowed &&
      item.price < highestPriceAllowed &&
      item.upc.toString().length == 12 &&
      item.caliber &&
      item.capacity
    ) {
      filtered.push(item);
    }
  });
  return filtered;
}

async function normalizeInventory(dataset) {
  let formattedInventory = [];
  dataset.map((item) => {
    let cat = findCategory(item.category, item.action);
    let newItem = {};

    newItem.cost = item.price;
    newItem.msrp = null;
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
    newItem.categories = cat.categories;
    newItem.shippingClass = cat.shippingClass;
    newItem.from = "SS";

    newItem.extra = [["Series", item.series]];

    formattedInventory.push(newItem);
  });

  return formattedInventory;
}

function findCategory(category, action) {
  let categories;
  let shippingClass = "firearm";

  switch (category) {
    case "SHOTGUNS":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 82 }];
      break;
    case "PISTOLS":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "RIFLES":
      shippingClass = "rifle-shotgun-pistol";
      switch (action) {
        case "Semi-Auto":
          categories = [{ id: 74 }, { id: 78 }, { id: 173 }];
          break;
        case "Bolt":
          categories = [{ id: 74 }, { id: 78 }, { id: 169 }];
          break;
        case "Lever":
          categories = [{ id: 74 }, { id: 78 }];
          break;
        case "Pump":
          categories = [{ id: 74 }, { id: 78 }];
          break;
        default:
          categories = [{ id: 74 }, { id: 78 }];
      }
      break;
    case "REVOLVERS":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 80 }];
      break;
    default:
      categories = [{ id: 74 }];
  }

  return { categories: categories, shippingClass: shippingClass };
}

async function prepSSInventory() {
  let unorganizedInventory = await getInventory();
  let inventory = await organizeInventory(unorganizedInventory);
  let filteredInventory = filterInventory(inventory);
  let normalizedInventory = await normalizeInventory(filteredInventory);
  return normalizedInventory;
}

async function checkSSInventory() {
  let unorganizedInventory = await getInventory();
  let inventory = await organizeInventory(unorganizedInventory);
  let minimizedInventory = minimizeInventory(inventory);
  return minimizedInventory;
}

export { prepSSInventory, checkSSInventory };
