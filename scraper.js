const axios = require('axios');
const readline = require('readline');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function scrapeAmazon(asin) {
  const params = {
    api_key: "939D2F2E4B4746AE8E4B6BC407C14238",
    amazon_domain: "amazon.com",
    asin: asin,
    type: "product"
  };

  try {
    const response = await axios.get('https://api.rainforestapi.com/request', { params });
    return response.data;
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  }
}

async function writeToFile(data, asin) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `amazon_${asin}_${timestamp}.json`;
  
  try {
    await fs.promises.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`Data successfully written to ${filename}`);
  } catch (error) {
    console.error('Error writing to file:', error);
  }
}

async function exportVariantsToCSV(data, asin) {
  if (!data || !data.product || !data.product.variants) {
    console.log('No variant data available in the last result.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `variants_${asin}_${timestamp}.csv`;
  
  try {
    // Create CSV header
    let csvContent = 'Variant ASIN,Parent ASIN\n';
    
    // Add each variant
    data.product.variants.forEach(variant => {
      csvContent += `${variant.asin},${data.product.parent_asin}\n`;
    });

    await fs.promises.writeFile(filename, csvContent);
    console.log(`Variants successfully exported to ${filename}`);
  } catch (error) {
    console.error('Error writing CSV:', error);
  }
}

function displayMenu() {
  console.log('\nOptions:');
  console.log('1. Scrape new ASIN');
  console.log('2. Write last result to file');
  console.log('3. Export variants to CSV');
  console.log('4. Exit');
  console.log('---------------------');
}

async function startApp() {
  let lastResult = null;
  let lastAsin = null;

  while (true) {
    displayMenu();
    
    const answer = await new Promise((resolve) => {
      rl.question('Please select an option (1-4): ', resolve);
    });

    switch (answer) {
      case '1':
        const asin = await new Promise((resolve) => {
          rl.question('Enter ASIN: ', resolve);
        });
        console.log('Fetching data...');
        lastResult = await scrapeAmazon(asin);
        lastAsin = asin;
        if (lastResult) {
          console.log('Data retrieved successfully:');
          console.log(JSON.stringify(lastResult, null, 2));
        }
        break;

      case '2':
        if (!lastResult) {
          console.log('No data available to write. Please scrape an ASIN first.');
        } else {
          await writeToFile(lastResult, lastAsin);
        }
        break;

      case '3':
        if (!lastResult) {
          console.log('No data available. Please scrape an ASIN first.');
        } else {
          await exportVariantsToCSV(lastResult, lastAsin);
        }
        break;

      case '4':
        console.log('\nThank you for using the Amazon Product Scraper!');
        rl.close();
        return;

      default:
        console.log('Invalid option. Please try again.');
    }
  }
}

// Start the application
console.log('Amazon Product Scraper');
console.log('---------------------');
startApp();

// Handle cleanup when the program exits
rl.on('close', () => {
  process.exit(0);
});