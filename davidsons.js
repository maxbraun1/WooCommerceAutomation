import fs from "fs";
import * as dotenv from "dotenv";
import * as ftp from "basic-ftp";
import csvToJson from "convert-csv-to-json/src/csvToJson.js";

dotenv.config();

async function getInventoryFile() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: "ftp.davidsonsinventory.com",
      user: process.env.DAVIDSONS_FTP_USERNAME,
      password: process.env.DAVIDSONS_FTP_PASSWORD,
      secure: false,
    });
    await client.downloadTo("files/davidsons_inventory.csv", "davidsons_inventory.csv");
    await client.downloadTo("files/DAV-inventory-with-MAP.txt", "DAV-inventory-with-MAP.txt");
    await client.downloadTo("files/davidsons_quantity.csv", "davidsons_quantity.csv");
  } catch (err) {
    console.log(err);
  }
  client.close();
}

async function getInventory() {
  await getInventoryFile();

  let revolverExtras = [
    "Revolver: Single Action",
    "Revolver: Double Action",
    "Revolver: Double Action Only",
    "Revolver: Single|Double",
  ];
  let rifleExtras = ["Rifle: Single Shot", "Rifle: Single Action"];
  let pistolExtras = ["Pistol: Derringer", "Pistol: Lever Action", "Pistol: Bolt Action", "Pistol: Single Action"];
  let shotgunMisc = ["Shotgun: Over and Under", "Shotgun: Over And Under"];
  let shotgunMisc2 = ["Shotgun: Side by Side", "Shotgun: Side By Side"];

  const data = fs.readFileSync("files/DAV-inventory-with-MAP.txt", "utf-8");
  const result = String(data).replace(/["]+/g, "");
  fs.writeFileSync("files/DAV-inventory-with-MAP.txt", result, "utf-8");

  let productMAPs = csvToJson
    .fieldDelimiter("\t")
    .formatValueByType()
    .getJsonFromCsv("files/DAV-inventory-with-MAP.txt");
  let DavidsonsQuantities = csvToJson.fieldDelimiter(",").getJsonFromCsv("files/davidsons_quantity.csv");

  productMAPs = productMAPs.map((item) => {
    let map;
    let newItem = {};
    if (item["RETAIL-MAP"] == "N/A") {
      map = 0;
    } else {
      map = Number(item["RETAIL-MAP"]);
    }

    newItem.upc = parseInt(item.UPC);
    newItem.map = map;
    return newItem;
  });

  let products = csvToJson.fieldDelimiter(",").getJsonFromCsv("files/davidsons_inventory.csv");

  let items = products.map((item) => {
    if (item.Quantity == "A*") {
      item.Quantity = 0;
    } else {
      let quantityInfo = DavidsonsQuantities.find(
        (product) => parseInt(product.UPC_Code) == parseInt(item.UPCCode.replace("#", ""))
      );
      if (quantityInfo) {
        item.Quantity =
          parseInt(quantityInfo.Quantity_NC.replace("+", "")) + parseInt(quantityInfo.Quantity_AZ.replace("+", ""));
      } else {
        item.Quantity = parseInt(item.Quantity);
      }
    }

    let info = productMAPs.find((product) => product.upc == parseInt(item.UPCCode.replace("#", "")));
    let map;
    if (!info) {
      map = 0;
    } else {
      map = info.map;
    }

    item.itemNo = item["Item#"];
    item.map = map;
    item.MSP = Number(item.MSP.replace("$", ""));
    item.DealerPrice = Number(item.DealerPrice.replace("$", ""));
    item.RetailPrice = Number(item.RetailPrice.replace("$", ""));
    item.UPCCode = parseInt(item.UPCCode.replace("#", ""));
    item.imageURL =
      "https://res.cloudinary.com/davidsons-inc/c_lpad,dpr_2.0,f_auto,h_635,q_100,w_635/v1/media/catalog/product/" +
      item.itemNo.charAt(0) +
      "/" +
      item.itemNo.charAt(1) +
      "/" +
      item.itemNo +
      ".jpg";

    if (revolverExtras.includes(item.GunType)) {
      item.GunType = "Revolver";
    }
    if (rifleExtras.includes(item.GunType)) {
      item.GunType = "Rifle";
    }
    if (pistolExtras.includes(item.GunType)) {
      item.GunType = "Pistol";
    }
    if (shotgunMisc.includes(item.GunType)) {
      item.GunType = "Shotgun: Over and Under";
    }
    if (shotgunMisc2.includes(item.GunType)) {
      item.GunType = "Shotgun: Side by Side";
    }
    if (item.GunType == "Shotgun: Pump") {
      item.GunType = "Shotgun: Pump Action";
    }

    delete item["Item#"];
    delete item.SalePrice;
    delete item.SaleEnds;

    return item;
  });
  return items;
}

function minimizeInventory(inventory) {
  let minimized = [];

  inventory.map((item) => {
    let min = {};
    min.upc = item.UPCCode.toString();
    min.cost = item.DealerPrice;
    min.quantity = item.Quantity;

    minimized.push(min);
  });

  return minimized;
}

function filterInventory(inventory) {
  let lowestQuantityAllowed = 20;
  let lowestPriceAllowed = 150;
  let typesAllowed = [
    "Pistol: Semi-Auto",
    "Pistol",
    "Rifle: Semi-Auto",
    "Rifle: Bolt Action",
    "Rifle: Lever Action",
    "Rifle: Pump Action",
    "Rifle",
    "Revolver",
    "Shotgun: Pump Action",
    "Shotgun: Over and Under",
    "Shotgun: Semi-Auto",
    "Shotgun: Lever Action",
    "Shotgun: Single Shot",
    "Shotgun: Bolt Action",
    "Shotgun: Side by Side",
  ];
  let filtered = [];

  inventory.map(async (item) => {
    if (
      item.Quantity >= lowestQuantityAllowed &&
      typesAllowed.includes(item.GunType) &&
      item.DealerPrice > lowestPriceAllowed
    ) {
      filtered.push(item);
    }
  });
  return filtered;
}

async function normalizeInventory(dataset) {
  let normalizedInventory = [];
  dataset.map((item) => {
    let cat = findCategory(item);
    let newItem = {};

    newItem.cost = item.DealerPrice;
    newItem.msrp = item.RetailPrice;
    newItem.upc = item.UPCCode.toString();
    newItem.imgURL = item.imageURL;
    newItem.map = item.map;
    newItem.desc = item.ItemDescription;
    newItem.quantity = item.Quantity;
    newItem.caliber = item.Caliber;
    newItem.manufacturer = item.Manufacturer;
    newItem.action = item.Action;
    newItem.capacity = item.Capacity;
    newItem.model = item.ModelSeries;
    newItem.categories = cat.categories;
    newItem.shippingClass = cat.shippingClass;
    newItem.from = "DAV";

    newItem.extra = [
      ["Overall Length", item.OverallLength],
      ["Finish", item.Finish],
      ["Sights", item.Sights],
      ["Barrel Length", item.BarrelLength],
      ["Features", item.Features],
    ];

    normalizedInventory.push(newItem);
  });

  return normalizedInventory;
}

function findCategory(item) {
  // Setting Category IDs and Shipping Class
  let categories;
  let shippingClass = "firearm";

  switch (item.GunType) {
    case "Pistol: Semi-Auto":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "Pistol":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "Rifle: Semi-Auto":
      categories = [{ id: 74 }, { id: 78 }, { id: 173 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Rifle: Bolt Action":
      categories = [{ id: 74 }, { id: 78 }, { id: 169 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Rifle: Lever Action":
      categories = [{ id: 74 }, { id: 78 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Rifle: Pump Action":
      categories = [{ id: 74 }, { id: 78 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Rifle":
      categories = [{ id: 74 }, { id: 78 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Revolver":
      categories = [{ id: 74 }, { id: 79 }, { id: 80 }];
      shippingClass = "handgun-revolver";
      break;
    case "Shotgun: Pump Action":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Shotgun: Over and Under":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Shotgun: Semi-Auto":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Shotgun: Lever Action":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Shotgun: Single Shot":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Shotgun: Bolt Action":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    case "Shotgun: Side by Side":
      categories = [{ id: 74 }, { id: 82 }];
      shippingClass = "rifle-shotgun-pistol";
      break;
    default:
      categories = [{ id: 74 }];
  }
  return { categories: categories, shippingClass: shippingClass };
}

async function prepDavidsonsInventory() {
  let inventory = await getInventory();
  let filteredInventory = filterInventory(inventory);
  let normalizedInventory = normalizeInventory(filteredInventory);
  return normalizedInventory;
}

async function checkDavidsonsInventory() {
  let inventory = await getInventory();
  let minimizedInventory = minimizeInventory(inventory);
  return minimizedInventory;
}

export { prepDavidsonsInventory, checkDavidsonsInventory };
