import fs from "fs";
import * as dotenv from "dotenv";
import csvToJson from "convert-csv-to-json/src/csvToJson.js";
import * as ftp from "basic-ftp";

dotenv.config();

async function getInventoryFiles() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: "rsrgroup.com",
      user: process.env.RSRUSERNAME,
      password: process.env.RSRPASSWORD,
      secure: false,
    });
    await client.downloadTo("files/rsrinventory.txt", "ftpdownloads/rsrinventory-new.txt");
    await client.downloadTo("files/attributes.txt", "ftpdownloads/attributes-all.txt");

    // Add headers to inventory file
    const InventoryData = fs.readFileSync("files/rsrinventory.txt");
    const Inventoryfd = fs.openSync("files/rsrinventory.txt", "w+");
    const InventoryHeaders =
      "stockNo;upc;description;dept;manufacturerId;retailPrice;rsrPrice;weight;quantity;model;mfgName;mfgPartNo;status;longDescription;imgName;AK;AL;AR;AZ;CA;CO;CT;DC;DE;FL;GA;HI;IA;ID;IL;IN;KS;KY;LA;MA;MD;ME;MI;MN;MO;MS;MT;NC;ND;NE;NH;NJ;NM;NV;NY;OH;OK;OR;PA;RI;SC;SD;TN;TX;UT;VA;VT;WA;WI;WV;WY;groundShipmentsOnly;adultSigRequired;noDropShip;date;retailMAP;imageDisclaimer;length;width;height;prop65;vendorApprovalRequired\n";
    const InventoryInsert = Buffer.from(InventoryHeaders);
    fs.writeSync(Inventoryfd, InventoryInsert, 0, InventoryInsert.length, 0);
    fs.writeSync(Inventoryfd, InventoryData, 0, InventoryData.length, InventoryInsert.length);
    fs.close(Inventoryfd, (err) => {
      if (err) console.log(err);
    });

    // Add headers to attributes file
    const AttributesData = fs.readFileSync("files/attributes.txt");
    const Attributesfd = fs.openSync("files/attributes.txt", "w+");
    const AttributesHeaders =
      "stockNo;manufacturerId;accessories;action;typeOfBarrel;barrelLength;catalogCode;chamber;chokes;condition;capacity;description;dram;edge;firingCasing;finish;fit;fit2;fps;frame;caliber;caliber2;grainWeight;grips;hand;mfg;mfgPartNo;weight;moa;model;model2;newStockNo;nsn;objective;ounceOfShot;packaging;power;reticle;safety;sights;size;type;unitsPerBox;unitsPerCase;wtCharacteristics;subCategory;diameter;color;material;stock;lensColor;handleColor;x;y;z\n";
    const AttributesInsert = Buffer.from(AttributesHeaders);
    fs.writeSync(Attributesfd, AttributesInsert, 0, AttributesInsert.length, 0);
    fs.writeSync(Attributesfd, AttributesData, 0, AttributesData.length, AttributesInsert.length);
    fs.close(Attributesfd, (err) => {
      if (err) throw err;
    });
  } catch (err) {
    console.log(err);
  }
  client.close();
}

async function getInventory() {
  await getInventoryFiles();

  let products = csvToJson.fieldDelimiter(";").getJsonFromCsv("files/rsrinventory.txt");
  let productInfo = csvToJson.fieldDelimiter(";").getJsonFromCsv("files/attributes.txt");

  let withImage = products.filter((item) => item.imgName);

  let items = withImage.map((item) => {
    item.upc = parseInt(item.upc);
    item.rsrPrice = Number(item.rsrPrice);
    item.quantity = parseInt(item.quantity);
    item.retailMAP = Number(item.retailMAP);
    item.imgName = item.imgName.replace(".", "_HR.");
    item.imageURL = "https://img.rsrgroup.com/highres-pimages/" + item.imgName;

    return item;
  });

  return filterProducts(items, productInfo);
}

function filterProducts(products, productInfo) {
  let lowestQuantityAllowed = 20;
  let lowestPriceAllowed = 150;
  let highestPriceAllowed = 3000;
  let typesAllowed = ["01", "05"];
  let categoriesAllowed = [
    "Modern Sporting Rifles",
    "Sporting Shotguns",
    "Pistols - Metal Frame",
    "Pistols - Polymer Frame",
    "Bullpups",
    "Defensive Shotguns",
    "Hunting Rifles",
    "Other Handguns",
    "Revolvers",
    "AK Style Rifles",
  ];
  let filtered = [];

  // First Filter and Combine product with product info
  products.map(async (item) => {
    if (
      item.quantity >= lowestQuantityAllowed &&
      typesAllowed.includes(item.dept) &&
      item.rsrPrice > lowestPriceAllowed &&
      item.rsrPrice < highestPriceAllowed &&
      item.upc.toString().length == 12
    ) {
      item.info = productInfo.find((info) => info.stockNo == item.stockNo);
      if (categoriesAllowed.includes(item.info.subCategory)) {
        filtered.push(item);
      }
    }
  });
  return filtered;
}

function minimizeInventory(inventory) {
  let minimized = [];

  inventory.map((item) => {
    let min = {};
    min.upc = item.upc.toString();
    min.cost = item.rsrPrice;
    min.quantity = item.quantity;

    minimized.push(min);
  });

  return minimized;
}

async function normalizeInventory(dataset) {
  let normalizedInventory = [];
  dataset.map((item) => {
    let cat = findCategory(item);
    let newItem = {};

    newItem.cost = item.rsrPrice;
    newItem.msrp = Number(item.retailPrice);
    newItem.upc = item.upc.toString();
    newItem.imgURL = item.imageURL;
    newItem.map = item.retailMAP;
    newItem.desc = item.longDescription;
    newItem.quantity = item.quantity;
    newItem.caliber = item.info.caliber;
    newItem.manufacturer = item.mfgName;
    newItem.action = item.info.action;
    newItem.capacity = item.info.capacity;
    newItem.model = item.model;
    newItem.categories = cat.categories;
    newItem.shippingClass = cat.shippingClass;
    newItem.from = "RSR";

    newItem.extra = [
      ["Finish", item.info.finish],
      ["Sights", item.info.sights],
      ["Barrel Length", item.info.barrelLength],
      ["Safety", item.info.safety],
      ["Color", item.info.color],
      ["Material", item.info.material],
    ];

    normalizedInventory.push(newItem);
  });
  return normalizedInventory;
}

function findCategory(item) {
  // Setting Category IDs and Shipping Class
  let categories;
  let shippingClass = "firearm";

  switch (item.info.subCategory) {
    case "Modern Sporting Rifles":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 78 }];
      break;
    case "Sporting Shotguns":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 82 }];
      break;
    case "Pistols - Metal Frame":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "Pistols - Polymer Frame":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "Bullpups":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 78 }];
      break;
    case "Defensive Shotguns":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 82 }];
      break;
    case "Hunting Rifles":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 78 }];
      break;
    case "Other Handguns":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 81 }];
      break;
    case "Revolvers":
      shippingClass = "handgun-revolver";
      categories = [{ id: 74 }, { id: 79 }, { id: 80 }];
      break;
    case "AK Style Rifles":
      shippingClass = "rifle-shotgun-pistol";
      categories = [{ id: 74 }, { id: 78 }];
      break;
    default:
      categories = [{ id: 74 }];
  }
  return { categories: categories, shippingClass: shippingClass };
}

async function prepRSRInventory() {
  let filteredInventory = await getInventory();
  let normalizedInventory = await normalizeInventory(filteredInventory);
  return normalizedInventory;
}

async function checkRSRInventory() {
  let inventory = await getInventory();
  let minimizedInventory = minimizeInventory(inventory);
  return minimizedInventory;
}

export { prepRSRInventory, checkRSRInventory };
