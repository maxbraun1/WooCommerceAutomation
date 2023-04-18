function descriptionGenerator(item){
    let html = "";

    html = html + "<table>";
    if(item.manufacturer != null && item.model != null && item.upc != null){ html = html + "<tr><td>Description</td><td>"+item.manufacturer + " " + item.model + " " + item.upc+"</td></tr>" };
    if(item.type != null){ html = html + "<tr><td>Type</td><td>"+item.type+"</td></tr>" };
    if(item.caliberGauge != null){ html = html + "<tr><td>Caliber</td><td>"+item.caliberGauge+"</td></tr>" };
    if(item.action != null){ html = html + "<tr><td>Action</td><td>"+item.action+"</td></tr>" };
    if(item.capacity != null){ html = html + "<tr><td>Capacity</td><td>"+item.capacity+"</td></tr>" };
    if(item.overallLength != null){ html = html + "<tr><td>Overall Length</td><td>"+item.overallLength+"</td></tr>" };
    if(item.weight != null){ html = html + "<tr><td>Weight</td><td>"+item.weight+"</td></tr>" };
    if(item.safety != null){ html = html + "<tr><td>Safety</td><td>"+item.safety+"</td></tr>" };
    if(item.frame != null){ html = html + "<tr><td>Frame Type</td><td>"+item.frame+"</td></tr>" };
    if(item.finish != null){ html = html + "<tr><td>Finish</td><td>"+item.finish+"</td></tr>" };
    if(item.sights != null){ html = html + "<tr><td>Sights</td><td>"+item.sights+"</td></tr>" };
    if(item.sightsType != null){ html = html + "<tr><td>Sights Type</td><td>"+item.sightsType+"</td></tr>" };
    if(item.stockFrameGrips != null){ html = html + "<tr><td>Grips</td><td>"+item.stockFrameGrips+"</td></tr>" };
    if(item.magazine != null){ html = html + "<tr><td>Magazine(s)</td><td>"+item.magazine+"</td></tr>" };
    if(item.additionalFeature1 != null){ html = html + "<tr><td>Additional Feature</td><td>"+item.additionalFeature1+"</td></tr>" };
    if(item.additionalFeature2 != null){ html = html + "<tr><td>Additional Feature</td><td>"+item.additionalFeature2+"</td></tr>" };
    if(item.additionalFeature3 != null){ html = html + "<tr><td>Additional Feature</td><td>"+item.additionalFeature3+"</td></tr>" };
    html = html + "</table><br>"

    html = html + "<span style='color:red;font-weight:bold'>ALL FIREARMS MUST BE SHIPPED TO A CURRENT FEDERAL FIREARMS LICENSED DEALER (FFL DEALER)</span><br>"

    html = html + "<span>It is the buyer's responsibility to verify that this <b>" + item.manufacturer + " " + item.model + " " + item.upc + "</b> and its Accessories (Magazine, Etc.), are compliant <a href='https://www.statefirearmlaws.org/state-state-firearm-law-data' target='_blank'>in your state</a>.</span><br>";

    html = html + "<span>It is the buyer's responsibility to contact the FFL dealer to ensure they accept transfers, also a copy of their FFL is required to be emailed to <a href='mailto:sales@secguns.com'>sales@secguns.com</a>, before purchasing a firearm. Your order will not be fulfilled without a copy of their FFL.</span><br>";

    html = html + "<span>If you have any questions, please check out our <a href='https://secguns.com/faq/'><span style='color: #3366ff;'>FAQs</span></a> or <a href='https://secguns.com/buying-a-gun-online/'><span style='color: #3366ff;'>Buying A Gun Online</span></a> page.</span><br>";

    html = html + "<span style='font-size:10px;line-height:1em !important'>This product photo may not represent the complete detail of the item being purchased. Please verify the product based on the UPC #, description, and specifications before ordering.<br>Orders are shipped using the courier of SEC Gun's choice and are usually delivered to the customer's FFL dealer within 3-4 business days after shipment. It may take anywhere from 7-10 business days to complete the process and ship your firearm to the chosen FFL Dealer. All firearms, magazines, receivers and restricted law enforcement items are sold and shipped in accordance with all existing federal, state and local laws and regulations. Many of the firearms, magazines and parts for sale on SEC Guns website may be restricted or prohibited in the customer's area. It is the customer's sole responsibility to confirm local and state regulations before ordering. Federal firearm laws prevent the sale of a firearm from any licensed dealer directly to an individual in another state. All firearms, or regulated firearm accessories must be shipped to a Federal Firearms Licensed dealer. It is the customer's sole responsibility to choose an FFL dealer to ship to.</span>"

    return html;
}

export default descriptionGenerator;