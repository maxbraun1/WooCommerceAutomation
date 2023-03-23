import axios from 'axios';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { generateImages } from './imageGenerator.js';
import chalk from 'chalk';
import { logProcess } from './index.js';
import { GunBrokerAccessToken } from './index.js';
import { xml2js } from 'xml-js';
import decodeHtml from 'decode-html';
import * as ftp from 'basic-ftp';
import csvToJson from 'convert-csv-to-json/src/csvToJson.js';
import { currentUserID } from './index.js';
import { LipseyAuthToken } from './index.js';

function getAllListings(){
	return new Promise( async (resolve, reject) => {
		let userID = await currentUserID;
		let token = await GunBrokerAccessToken;
		await axios.get('https://api.gunbroker.com/v1/Items?BuyNowOnly=true&PageSize=1&IncludeSellers='+userID,{
			headers: {
				'Content-Type': 'application/json',
				"User-Agent": "axios 0.21.1",
				'X-DevKey': process.env.GUNBROKER_DEVKEY,
				'X-AccessToken': token
			},
		})
		.then(async (response) => {
			let listings = []
			let listingsNum = response.data.countReturned; // Total number of listinigs
			let iterations = Math.ceil(listingsNum/300); // Number of times to request results in sets of 300
			for(let i = 1; i <= iterations; i++){
				let token = await GunBrokerAccessToken;
				await axios.get('https://api.gunbroker.com/v1/Items?Exclude=gold&BuyNowOnly=true&PageSize=300&PageIndex='+i+'&IncludeSellers='+userID,{
					headers: {
						'Content-Type': 'application/json',
						'X-DevKey': process.env.GUNBROKER_DEVKEY,
						'X-AccessToken': token
					},
				}).then((response) => {
					// get item IDs of all listings returned
					
					for(const listing in response.data.results){
						listings.push(response.data.results[listing].itemID);
					}
				}).catch(function (error) {
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

async function getListing(itemNo){
  return new Promise( async (resolve,reject)=>{
    let token = await GunBrokerAccessToken;
    await axios.get('https://api.gunbroker.com/v1/Items/' + itemNo,{
      headers: {
        'Content-Type': 'application/json',
        'X-DevKey': process.env.GUNBROKER_DEVKEY,
        'X-AccessToken': token,
        "User-Agent": "axios 0.21.1"
      },
    }).then((response) => {
      resolve({upc: response.data.upc, itemNo: itemNo});
    }).catch((error) => {
      reject(error);
    })
  });
}

function getLipseysInventory(){
	return new Promise(async (resolve,reject) => {
    let token = await LipseyAuthToken;
    await axios.get('https://api.lipseys.com/api/Integration/Items/CatalogFeed', {
      headers: {
        Token: token
      }
    }).then(function (response) {
			let dataset = response.data.data;
			let lipseysProducts = [];
			dataset.map((item) => {
				let newItem = {};
				newItem.upc = parseInt(item.upc);
				newItem.imageURL = "https://www.lipseyscloud.com/images/"+item.imageName;

				lipseysProducts.push(newItem);
			});
      resolve(lipseysProducts);
    }).catch(function (error) {
      reject(error);
    });
  });
}

async function getDavidsonsInventory(){
	const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
      await client.access({
          host: "ftp.davidsonsinventory.com",
          user: process.env.DAVIDSONS_FTP_USERNAME,
          password: process.env.DAVIDSONS_FTP_PASSWORD,
          secure: false
      });
      await client.downloadTo("davidsons_inventory.csv", "davidsons_inventory.csv");
  }
  catch(err) {
      console.log(err);
  }

	let products = csvToJson.fieldDelimiter(',').getJsonFromCsv('davidsons_inventory.csv');

	let davidsonsProducts = [];

  products.map((item) => {
		let newItem = {};
    newItem.upc = parseInt(item.UPCCode.replace('#', ''));
    newItem.imageURL = 'https://res.cloudinary.com/davidsons-inc/c_lpad,dpr_2.0,f_auto,h_635,q_100,w_635/v1/media/catalog/product/' + item["Item#"].charAt(0) + "/" + item["Item#"].charAt(1) + "/" + item["Item#"] + ".jpg";
    davidsonsProducts.push(newItem);
  });

	return davidsonsProducts;
}

async function getRSRInventory(){
	const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
		await client.access({
			host: "rsrgroup.com",
			user: process.env.RSRUSERNAME,
			password: process.env.RSRPASSWORD,
			secure: false
		});
		//console.log(await client.list());
		await client.downloadTo("rsrinventory.txt", "ftpdownloads/rsrinventory-new.txt");

		// Add headers to inventory file
		const InventoryData = fs.readFileSync('rsrinventory.txt')
		const Inventoryfd = fs.openSync('rsrinventory.txt', 'w+')
		const InventoryHeaders = "stockNo;upc;description;dept;manufacturerId;retailPrice;rsrPrice;weight;quantity;model;mfgName;mfgPartNo;status;longDescription;imgName;AK;AL;AR;AZ;CA;CO;CT;DC;DE;FL;GA;HI;IA;ID;IL;IN;KS;KY;LA;MA;MD;ME;MI;MN;MO;MS;MT;NC;ND;NE;NH;NJ;NM;NV;NY;OH;OK;OR;PA;RI;SC;SD;TN;TX;UT;VA;VT;WA;WI;WV;WY;groundShipmentsOnly;adultSigRequired;noDropShip;date;retailMAP;imageDisclaimer;length;width;height;prop65;vendorApprovalRequired\n";
		const InventoryInsert = Buffer.from(InventoryHeaders);
		fs.writeSync(Inventoryfd, InventoryInsert, 0, InventoryInsert.length, 0)
		fs.writeSync(Inventoryfd, InventoryData, 0, InventoryData.length, InventoryInsert.length)
		fs.close(Inventoryfd, (err) => {
			if (err) throw err;
		});
  }
  catch(err) {
    console.log(err);
  }
  console.log(chalk.bold.green("File downloaded and headers added."));
  client.close();

	let products = csvToJson.getJsonFromCsv('rsrinventory.txt');

  let withImage = products.filter( item => item.imgName );

	let RSRInventory = [];
  let items = withImage.map((item) => {
		let newItem = {};
    newItem.upc = parseInt(item.upc);
    newItem.imageURL = 'https://img.rsrgroup.com/highres-pimages/' + item.imgName.replace('.','_HR.');

    RSRInventory.push(newItem);
  });

	return RSRInventory;
}

async function replaceImage(url, itemID){
	return new Promise(async (resolve,reject) => {
		generateImages(url)
		.then(async () => {
			// prepare image
			let newThumbnail = fs.readFileSync('tmp/thumbnail.jpeg');
			const thumbnailBlob = new Blob([newThumbnail], { name: "picture", type: 'image/jpeg', 'Content-Disposition':'form-data' });
			const data = new FormData();
      data.append("picture", thumbnailBlob, 'new-thumbnail.jpeg');

			console.log("posting");
			resolve(true);

			/*let token = await GunBrokerAccessToken;
      await axios.post('https://api.gunbroker.com/v1/Pictures/'+itemID, data, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-DevKey': process.env.GUNBROKER_DEVKEY,
          'X-AccessToken': token
        }
      })
      .then(function (response) {
				resolve(true);
      })
      .catch(function (error) {
        reject(error.response.data);
      });
			*/
		}).catch((error) => {reject(error)});
	});
}

export async function fixImages(limit){
  // Get every Gunbroker listing item No
  logProcess("Getting all GunBroker listings");
  let listingIDs = await getAllListings();

  // Get every listing from Lipseys, Davidsons, and RSR
  logProcess("Getting Lipseys Inventory");
  let LipseysInventory = await getLipseysInventory();
	
  logProcess("Getting Davidsons Inventory");
  //let DavidsonsInventory = await getDavidsonsInventory();
	
  logProcess("Getting RSR Inventory");
  //let RSRInventory = await getRSRInventory();

	let updatedCount = 0;

  for (const listingID of listingIDs){
		if(updatedCount < limit){
			let listing = await getListing(listingID).catch((error) => {console.log(error)});

			// Find image URL from UPC
			
			if(await LipseysInventory.find(product => product.upc == listing.upc)){
				let result = await replaceImage(LipseysInventory.find(product => product.upc == listing.upc).imageURL, listingID).catch((error) => console.log(chalk.bold.red(error)))
				.catch((error) => console.log(chalk.red(error)));
				if(result){
					console.log(chalk.bold.green("Image added for item ["+listingID+"]"));
					updatedCount++;
				}else{
					console.log(result);
				}
			}
		}
	}
}