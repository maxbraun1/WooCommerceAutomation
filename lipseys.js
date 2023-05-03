import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

let LipseyAuthToken = new Promise(function (resolve, reject) {
  const login_credentials = {
    Email: process.env.LIPSEY_EMAIL,
    Password: process.env.LIPSEY_PASSWORD,
  };
  axios
    .post("https://api.lipseys.com/api/Integration/Authentication/Login", login_credentials, {
      headers: {
        "Content-Type": "application/json",
      },
    })
    .then(function (response) {
      resolve(response.data.token);
    })
    .catch(function (error) {
      reject(new Error(error));
    });
});

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

function minimizeInventory(inventory) {
  let minimized = [];

  inventory.map((item) => {
    let min = {};
    min.upc = item.upc;
    min.cost = item.price;
    min.quantity = item.quantity;

    minimized.push(min);
  });

  return minimized;
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

async function prepLipseysInventory() {
  let inventory = await getInventory().catch((error) => console.log(error));
  let filteredInventory = await filterInventory(inventory);
  let normalizedInventory = await normalizeInventory(filteredInventory);
  return normalizedInventory;
}

async function checkLipseysInventory() {
  let inventory = await getInventory().catch((error) => console.log(error));
  let minimizedInventory = minimizeInventory(inventory);
  return minimizedInventory;
}

export { prepLipseysInventory, checkLipseysInventory };
