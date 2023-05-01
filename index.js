import axios from "axios";
import fs from "fs";
import * as dotenv from "dotenv";
import chalk from "chalk";
import * as ftp from "basic-ftp";
import csvToJson from "convert-csv-to-json";
import decodeHtml from "decode-html";
import { xml2js } from "xml-js";
import { prepLipseysInventory } from "./lipseys.js";
import { prepDavidsonsInventory } from "./davidsons.js";
import { prepRSRInventory } from "./rsr.js";
import { prepSSInventory } from "./sportssouth.js";
import stringSimilarity from "string-similarity";
import pkg from "@woocommerce/woocommerce-rest-api";
import SFTPClient from "ssh2-sftp-client";
import { postItem } from "./post.js";
import { generateImages } from "./imageGenerator.js";
const WooCommerceRestApi = pkg.default;

dotenv.config();

const WooCommerce = new WooCommerceRestApi({
  url: "https://secguns.com",
  consumerKey: process.env.SEC_KEY,
  consumerSecret: process.env.SEC_SECRET,
  version: "wc/v3",
});

let client = new SFTPClient();
await client.connect({
  host: "secgunsdev.sftp.wpengine.com",
  port: "2222",
  user: process.env.SEC_FTP_USER,
  password: process.env.SEC_FTP_PASS,
});

function logProcess(message, type) {
  console.log("_________________________________________________________________________________");
  switch (type) {
    case "good":
      console.log(chalk.green(message));
      break;
    case "bad":
      console.log(chalk.red(message));
      break;
    case "warning":
      console.log(chalk.yellow(message));
      break;
    default:
      console.log(chalk.magenta(message));
  }
}

function checkAlreadyPosted(upc) {
  return new Promise(async (resolve, reject) => {
    WooCommerce.get("products/?sku=" + upc)
      .then((response) => {
        if (response.data.length > 0) {
          resolve(true);
        } else {
          resolve(false);
        }
      })
      .catch((error) => {
        console.log(error.response.data);
        reject(error);
      });
  });
}

function getAllListings() {
  return new Promise((resolve, reject) => {
    WooCommerce.get("products?per_page=100")
      .then(async function (response) {
        let pages = response.headers["x-wp-totalpages"];
        let listings = [];
        for (let x = 0; x < pages; x++) {
          let offset = x * 100;
          await WooCommerce.get("products?per_page=100&offset=" + offset)
            .then(function (response) {
              response.data.map((item) => {
                let newListing = {};
                newListing.id = item.id;
                newListing.upc = parseInt(item.sku);
                newListing.quantity = item.stock_quantity;
                newListing.tags = item.tags;

                listings.push(newListing);
              });
            })
            .catch(function (error) {
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

async function getLipseysInventory() {
  return new Promise(async (resolve, reject) => {
    let token = await LipseyAuthToken;
    await axios
      .get("https://api.lipseys.com/api/Integration/Items/CatalogFeed", {
        headers: {
          Token: token,
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

async function getDavidsonsInventoryFile() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: "ftp.davidsonsinventory.com",
      user: process.env.DAVIDSONS_FTP_USERNAME,
      password: process.env.DAVIDSONS_FTP_PASSWORD,
      secure: false,
    });
    await client.downloadTo("davidsons_quantity.csv", "davidsons_quantity.csv");
    await client.downloadTo("davidsons_inventory.csv", "davidsons_inventory.csv");
  } catch (err) {
    console.log(err);
  }
  console.log(chalk.bold.green("File downloaded."));
  client.close();
}

async function getDavidsonsInventory() {
  await getDavidsonsInventoryFile();

  let DavidsonsInventory = csvToJson.fieldDelimiter(",").getJsonFromCsv("davidsons_quantity.csv");

  let products = [];

  DavidsonsInventory.map((item) => {
    let product = {};
    product.upc = parseInt(item.UPC_Code.replace("#", ""));
    product.quantity = parseInt(item.Quantity_NC.replace("+", "")) + parseInt(item.Quantity_AZ.replace("+", ""));

    products.push(product);
  });

  return products;
}

async function getRSRInventoryFile() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: "rsrgroup.com",
      user: process.env.RSRUSERNAME,
      password: process.env.RSRPASSWORD,
      secure: false,
    });
    await client.downloadTo("rsrinventory.txt", "ftpdownloads/rsrinventory-new.txt");

    // Add headers to inventory file
    const InventoryData = fs.readFileSync("rsrinventory.txt");
    const Inventoryfd = fs.openSync("rsrinventory.txt", "w+");
    const InventoryHeaders =
      "stockNo;upc;description;dept;manufacturerId;retailPrice;rsrPrice;weight;quantity;model;mfgName;mfgPartNo;status;longDescription;imgName;AK;AL;AR;AZ;CA;CO;CT;DC;DE;FL;GA;HI;IA;ID;IL;IN;KS;KY;LA;MA;MD;ME;MI;MN;MO;MS;MT;NC;ND;NE;NH;NJ;NM;NV;NY;OH;OK;OR;PA;RI;SC;SD;TN;TX;UT;VA;VT;WA;WI;WV;WY;groundShipmentsOnly;adultSigRequired;noDropShip;date;retailMAP;imageDisclaimer;length;width;height;prop65;vendorApprovalRequired\n";
    const InventoryInsert = Buffer.from(InventoryHeaders);
    fs.writeSync(Inventoryfd, InventoryInsert, 0, InventoryInsert.length, 0);
    fs.writeSync(Inventoryfd, InventoryData, 0, InventoryData.length, InventoryInsert.length);
    fs.close(Inventoryfd, (err) => {
      if (err) throw err;
    });
  } catch (err) {
    console.log(err);
  }
  console.log(chalk.bold.green("File downloaded and headers added."));
  client.close();
}

async function getRSRInventory() {
  await getRSRInventoryFile();

  let RSRInventory = csvToJson.fieldDelimiter(";").getJsonFromCsv("rsrinventory.txt");

  let products = [];

  RSRInventory.map((item) => {
    let product = {};
    product.upc = parseInt(item.upc);
    product.price = Number(item.rsrPrice);
    product.quantity = parseInt(item.quantity);
    product.map = Number(item.retailMAP);
    product.imageURL = "https://img.rsrgroup.com/highres-pimages/" + item.imgName;

    products.push(product);
  });

  return products;
}

async function getSSInventory() {
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
      .then(async function (response) {
        let decoded = decodeHtml(response.data);
        let xml = xml2js(decoded, { compact: true, spaces: 2 });
        let products = xml.string.NewDataSet.Table;

        let formatted = [];
        for (let item of products) {
          if (parseInt(item.ITYPE._text) == 1 || parseInt(item.ITYPE._text) == 2) {
            // Skip if undefined
            if (item.IMODEL._text == undefined) {
              continue;
            }
            if (item.MFGINO._text == undefined) {
              continue;
            }
            //console.log(item);
            let newItem = {};
            newItem.upc = parseInt(item.ITUPC._text);
            newItem.quantity = parseInt(item.QTYOH._text);
            newItem.map = Number(item.MFPRC._text);

            formatted.push(newItem);
          }
        }
        resolve(formatted);
      })
      .catch(function (error) {
        reject(error);
      });
  });
}

async function checkAllListings() {
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

  // Loop through every SEC Guns listing
  console.log(chalk.green.bold("Checking " + listings.length + " listings."));
  for (let i = 0; i < listings.length; i++) {
    let listing = listings[i];

    if (!listing.tags.find((tag) => tag.name == "ap")) {
      continue;
    }

    if (listing) {
      let lipseysResults = await LipseysInventory.find((item) => item.upc == listing.upc);
      let RSRResults = await RSRInventory.find((item) => item.upc == listing.upc);
      let davidsonsResults = await DavidsonsInventory.find((item) => item.upc == listing.upc);
      let SSResults = await SSInventory.find((item) => item.upc == listing.upc);
      if (lipseysResults == undefined) {
        lipseysResults = {};
        lipseysResults.quantity = 0;
      }
      if (RSRResults == undefined) {
        RSRResults = {};
        RSRResults.quantity = 0;
      }
      if (davidsonsResults == undefined) {
        davidsonsResults = {};
        davidsonsResults.quantity = 0;
      }
      if (SSResults == undefined) {
        SSResults = {};
        SSResults.quantity = 0;
      }

      let totalAvailableQuantity =
        lipseysResults.quantity + RSRResults.quantity + davidsonsResults.quantity + SSResults.quantity;

      if (listing.quantity > totalAvailableQuantity - 10 && listing.quantity != 0) {
        // if quantity listed is less than quantity available minus 10, set quantity to 0

        const data = {
          stock_quantity: 0,
        };

        await WooCommerce.put("products/" + listing.id, data)
          .then((response) => {
            console.log(
              chalk.bold.red("Listing QTY: " + listing.quantity + " | Vendor QTY: " + totalAvailableQuantity)
            );
            console.log(chalk.bold.yellow("[" + listing.upc + "] Item quantity set to 0."));
          })
          .catch((error) => {
            console.log("error", error);
          });
      }
    }
  }
  console.log("done");
  return;
}

async function updateQuantity(item) {
  await WooCommerce.get("products/?sku=" + item.upc)
    .then(async (response) => {
      let quantityPosted = response.data[0].stock_quantity;
      let productID = response.data[0].id;
      if (quantityPosted == 0) {
        // Setting Quantity
        let quantity;

        if (item.quantity >= 50) {
          quantity = 10;
        } else if (item.quantity < 50 && item.quantity >= 20) {
          quantity = 5;
        } else {
          return;
        }

        // Update Quantity
        const data = {
          stock_quantity: quantity,
        };

        await WooCommerce.put("products/" + productID, data)
          .then((response) => {
            console.log(chalk.green.bold("[" + item.upc + "] Item quantity updated."));
          })
          .catch((error) => {
            console.log(error.response.data);
          });
      }
    })
    .catch((error) => {
      console.log(error.response.data);
    });
}

async function checkDuplicates(inventory) {
  let duplicateCount = 0;
  await inventory.map((item, index) => {
    let matches = inventory.filter((x) => x.upc == item.upc && x.from != item.from);
    if (matches.length > 0) {
      let highestCost = item.cost;
      let quantity = item.quantity;
      matches.map((match, matchIndex) => {
        quantity = quantity + match.quantity;
        if (match.cost > highestCost) {
          highestCost = match.cost;
        }
        inventory.splice(inventory.indexOf(match), 1);
      });
      item.cost = highestCost;
      item.quantity = quantity;
    }
  });
  console.log(inventory.length);
  return inventory;
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
        chalk.bold.blue.bgWhite(" Item " + count + " / " + listings.length + " ") +
          chalk.bold.yellow(" [" + item.upc + "] Item already posted.")
      );
      await updateQuantity(item);
    } else {
      await generateImages(item.imgURL, item.upc)
        .then(async (imageLocation) => {
          await postItem(item, imageLocation)
            .catch((error) => console.log(error))
            .then(() => {
              countPosted++;
              console.log(
                chalk.bold.blue.bgWhite(" Item " + count + " / " + listings.length + " ") +
                  chalk.bold.green(" [" + item.upc + "] Item (" + item.manufacturer + " " + item.model + ") Posted")
              );
            });
        })
        .catch((error) => {
          console.log(error);
        });
    }
  }
  console.log(chalk.bold.green("Posting complete. " + countPosted + " listings posted."));
  return countPosted;
}

export { logProcess, checkAlreadyPosted, LipseyAuthToken, client };

// RUN PROCESS

async function post(vendors) {
  let inventory = [];

  if (vendors.lip) {
    let lipseysInventory = await prepLipseysInventory();
    console.log(chalk.bold.green("------------- LIPSEYS -------------"));
    console.log(lipseysInventory.length);
    inventory.push(...lipseysInventory);
  }
  if (vendors.dav) {
    let davidsonsInventory = await prepDavidsonsInventory();
    console.log(chalk.bold.green("------------ DAVIDSONS ------------"));
    console.log(davidsonsInventory.length);
    inventory.push(...davidsonsInventory);
  }
  if (vendors.rsr) {
    let rsrInventory = await prepRSRInventory();
    console.log(chalk.bold.green("--------------- RSR ---------------"));
    console.log(rsrInventory.length);
    inventory.push(...rsrInventory);
  }
  if (vendors.ss) {
    let ssInventory = await prepSSInventory();
    console.log(chalk.bold.green("----------- SPORTS SOUTH ----------"));
    console.log(ssInventory.length);
    inventory.push(...ssInventory);
  }

  console.log(inventory.length + " total products before duplicate check");

  // Check for duplicates
  inventory = await checkDuplicates(inventory);

  await postAllItems(inventory);
}

// START
post({ lip: true, dav: true, rsr: true, ss: true });
//checkAllListings();
