const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Add this near the top of the file, after the imports
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Initialize database
const db = new sqlite3.Database('amazon_products.db');

// Create tables if they don't exist
function initializeDatabase() {
  db.serialize(() => {
    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
      parent_asin TEXT PRIMARY KEY,
      title TEXT,
      brand TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Variants table
    db.run(`CREATE TABLE IF NOT EXISTS variants (
      asin TEXT PRIMARY KEY,
      parent_asin TEXT,
      color TEXT,
      ring_size TEXT,
      is_requested_variant BOOLEAN,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_asin) REFERENCES products (parent_asin)
    )`);
  });
}

async function saveToDatabase(data, requestedAsin) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      try {
        // Insert product data
        const productStmt = db.prepare(
          'INSERT OR REPLACE INTO products (parent_asin, title, brand) VALUES (?, ?, ?)'
        );
        
        productStmt.run(
          data.product.parent_asin,
          data.product.title,
          data.product.brand
        );
        productStmt.finalize();

        // Only process variants if they exist
        if (data.product.variants && Array.isArray(data.product.variants)) {
          const variantStmt = db.prepare(
            'INSERT OR REPLACE INTO variants (asin, parent_asin, color, ring_size, is_requested_variant) VALUES (?, ?, ?, ?, ?)'
          );

          data.product.variants.forEach(variant => {
            const color = variant.dimensions?.find(d => d.name === 'Color')?.value || '';
            const ringSize = variant.dimensions?.find(d => d.name === 'Ring Size')?.value || '';
            
            variantStmt.run(
              variant.asin,
              data.product.parent_asin,
              color,
              ringSize,
              variant.is_current_product ? 1 : 0
            );
          });

          variantStmt.finalize();
        }

        db.run('COMMIT');
        resolve();
      } catch (error) {
        db.run('ROLLBACK');
        reject(error);
      }
    });
  });
}

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
    // Get all unique dimension names from all variants
    const dimensionNames = new Set();
    data.product.variants.forEach(variant => {
      variant.dimensions?.forEach(dim => {
        dimensionNames.add(dim.name);
      });
    });

    // Create CSV header with all dimension names plus requested variant indicator
    const headerRow = [
      'Variant ASIN', 
      'Parent ASIN', 
      'Is Requested Variant', // renamed to be more clear
      ...Array.from(dimensionNames)
    ];
    let csvContent = headerRow.join(',') + '\n';
    
    // Add each variant with all its dimensions
    data.product.variants.forEach(variant => {
      const row = [
        variant.asin, 
        data.product.parent_asin,
        variant.is_current_product ? 'true' : 'false'
      ];
      
      // Add values for each dimension
      dimensionNames.forEach(dimName => {
        let value = variant.dimensions?.find(d => d.name === dimName)?.value || '';
        const escapedValue = value.includes(',') ? `"${value}"` : value;
        row.push(escapedValue);
      });

      csvContent += row.join(',') + '\n';
    });

    await fs.promises.writeFile(filename, csvContent);
    console.log(`Variants successfully exported to ${filename}`);
  } catch (error) {
    console.error('Error writing CSV:', error);
  }
}

// Add this function to handle batch processing
async function batchProcess(inputAsins) {
  const asins = inputAsins
    .split(/[\s,]+/)
    .map(asin => asin.trim())
    .filter(asin => asin.length > 0);

  console.log(`Processing ${asins.length} ASINs...`);

  // Modified CSV header to handle multiple variant columns
  let csvContent = 'Input ASIN,Parent ASIN,Title,Brand,Variant 1,Variant 2,Variant 3,Variant 4,Variant 5,Variant 6,Variant 7,Variant 8,Variant 9,Variant 10\n';

  for (const asin of asins) {
    console.log(`Processing ASIN: ${asin}...`);
    const result = await scrapeAmazon(asin);
    
    if (result && result.product) {
      // Create an array of variant ASINs, padded with empty strings if needed
      const variantAsins = result.product.variants 
        ? result.product.variants.map(v => v.asin)
        : [];
      
      // Pad with empty strings to ensure 10 columns
      while (variantAsins.length < 10) {
        variantAsins.push('');
      }

      // Add row to CSV with variants in separate columns
      csvContent += `${asin},${result.product.parent_asin},"${result.product.title}","${result.product.brand}",${variantAsins.slice(0, 10).join(',')}\n`;
      
      await saveToDatabase(result, asin);
    } else {
      // Error case - fill variant columns with empty values
      csvContent += `${asin},ERROR,ERROR,ERROR,,,,,,,,,,,\n`;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `batch_results_${timestamp}.csv`;
  
  try {
    await fs.promises.writeFile(filename, csvContent);
    console.log(`Batch results written to ${filename}`);
  } catch (error) {
    console.error('Error writing batch results:', error);
  }
}

function displayMenu() {
  console.log('\nOptions:');
  console.log('1. Scrape new ASIN');
  console.log('2. Write last result to file');
  console.log('3. Export variants to CSV');
  console.log('4. Save to database');
  console.log('5. Batch process multiple ASINs');
  console.log('6. Exit');
  console.log('---------------------');
}

async function startApp() {
  // Initialize database
  initializeDatabase();

  let lastResult = null;
  let lastAsin = null;

  while (true) {
    displayMenu();
    
    const answer = await new Promise((resolve) => {
      rl.question('Please select an option (1-6): ', resolve);
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
        if (!lastResult) {
          console.log('No data available. Please scrape an ASIN first.');
        } else {
          console.log('Saving to database...');
          await saveToDatabase(lastResult, lastAsin);
          console.log('Data saved successfully!');
        }
        break;

      case '5':
        const inputAsins = await new Promise((resolve) => {
          rl.question('Enter ASINs (separated by commas or newlines): ', resolve);
        });
        await batchProcess(inputAsins);
        break;

      case '6':
        console.log('\nThank you for using the Amazon Product Scraper!');
        db.close();
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