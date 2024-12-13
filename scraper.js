const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const ExcelJS = require('exceljs');

// Add color constants at the top of the file
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

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
    console.log(colors.cyan + `Making Rainforest API request for ASIN: ${asin}...` + colors.reset);
    const response = await axios.get('https://api.rainforestapi.com/request', { params });
    console.log(colors.green + `✅ Received response from Rainforest API` + colors.reset);
    
    // Log the first level of the response structure
    console.log(colors.yellow + '\nResponse structure:' + colors.reset);
    console.log('Keys in response:', Object.keys(response.data));
    if (response.data.product) {
        console.log('Keys in product:', Object.keys(response.data.product));
        console.log('Brand store data:', response.data.product.brand_store);
    }
    
    return response.data;
  } catch (error) {
    console.error(colors.red + 'Error with Rainforest API:', error.message + colors.reset);
    if (error.response) {
        console.error(colors.red + 'Error response:', JSON.stringify(error.response.data, null, 2) + colors.reset);
    }
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

  console.log(colors.cyan + `📊 Processing ${asins.length} ASINs...` + colors.reset);

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
    console.log(colors.green + `✅ Batch results written to ${filename}` + colors.reset);
  } catch (error) {
    console.error('Error writing batch results:', error);
  }
}

async function batchProcessByParent(inputAsins) {
  const asins = inputAsins
    .split(/[\s,]+/)
    .map(asin => asin.trim())
    .filter(asin => asin.length > 0);

  console.log(colors.cyan + `📊 Processing ${asins.length} ASINs...` + colors.reset);

  // Object to store unique parent ASINs and their data
  const parentAsinMap = new Map();

  for (const asin of asins) {
    console.log(`Processing ASIN: ${asin}...`);
    const result = await scrapeAmazon(asin);
    
    if (result && result.product && result.product.parent_asin) {
      const parentAsin = result.product.parent_asin;
      
      // Only process if we haven't seen this parent ASIN before
      if (!parentAsinMap.has(parentAsin)) {
        const variantAsins = result.product.variants 
          ? result.product.variants.map(v => v.asin)
          : [];
        
        // Pad with empty strings to ensure 10 columns
        while (variantAsins.length < 10) {
          variantAsins.push('');
        }

        parentAsinMap.set(parentAsin, {
          title: result.product.title,
          brand: result.product.brand,
          variants: variantAsins.slice(0, 10)
        });

        await saveToDatabase(result, asin);
      }
    }
  }

  // Create CSV content
  let csvContent = 'Parent ASIN,Title,Brand,Variant 1,Variant 2,Variant 3,Variant 4,Variant 5,Variant 6,Variant 7,Variant 8,Variant 9,Variant 10\n';

  // Add each unique parent ASIN and its data
  for (const [parentAsin, data] of parentAsinMap) {
    csvContent += `${parentAsin},"${data.title}","${data.brand}",${data.variants.join(',')}\n`;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `parent_batch_results_${timestamp}.csv`;
  
  try {
    await fs.promises.writeFile(filename, csvContent);
    console.log(colors.green + `✅ Parent batch results written to ${filename}` + colors.reset);
  } catch (error) {
    console.error('Error writing batch results:', error);
  }
}

// Add new function for variant relationship analysis
async function analyzeVariantRelationships(initialAsin) {
  console.log('Starting variant relationship analysis...');
  
  const processedAsins = new Set();
  const results = [];
  let variationTypes = new Set();
  let parentTitle = '';
  let parentTitleExcludingVariant = '';
  
  // Process initial ASIN
  const initialResult = await scrapeAmazon(initialAsin);
  if (!initialResult || !initialResult.product) {
    console.log('Could not fetch data for initial ASIN');
    return;
  }

  const parentAsin = initialResult.product.parent_asin;
  console.log(`Found parent ASIN: ${parentAsin}`);

  // Collect all variation types first from initial result
  if (initialResult.product.variants) {
    initialResult.product.variants.forEach(variant => {
      if (variant.dimensions) {
        variant.dimensions.forEach(dim => {
          variationTypes.add(dim.name);
        });
      }
    });
  }

  // Process parent first
  if (parentAsin && parentAsin !== initialAsin) {
    console.log(`\nProcessing parent ASIN first: ${parentAsin}`);
    const parentResult = await scrapeAmazon(parentAsin);
    
    if (parentResult && parentResult.product) {
        const parentVariationValues = {};
        
        // First try to get variant info from the initial result's variants
        if (initialResult.product.variants) {
            console.log('Checking initial result variants for parent data...');
            initialResult.product.variants.forEach(variant => {
                if (variant.dimensions) {
                    variant.dimensions.forEach(dim => {
                        variationTypes.add(dim.name);
                        // Store default values from all variants
                        if (!parentVariationValues[dim.name]) {
                            parentVariationValues[dim.name] = '';
                        }
                    });
                }
            });
        }

        // Then check parent's own variants
        if (parentResult.product.variants) {
            console.log('Checking parent result variants...');
            parentResult.product.variants.forEach(variant => {
                if (variant.dimensions) {
                    variant.dimensions.forEach(dim => {
                        variationTypes.add(dim.name);
                        // Store default values from all variants
                        if (!parentVariationValues[dim.name]) {
                            parentVariationValues[dim.name] = '';
                        }
                    });
                }
            });
        }

        parentTitle = normalizeTitle(parentResult.product.title);
        parentTitleExcludingVariant = normalizeTitle(parentResult.product.title_excluding_variant_name);
        
        console.log('\nParent titles stored:');
        console.log('Full:', parentTitle);
        console.log('Excluding variant:', parentTitleExcludingVariant);
        
        results.push({
            asin: parentAsin,
            parentAsin: parentAsin,
            category: parentResult.product.categories_flat || parentResult.product.search_alias?.title || '',
            title: parentResult.product.title,
            title_excluding_variant_name: parentResult.product.title_excluding_variant_name || parentResult.product.title,
            type: 'PARENT',
            variationValues: parentVariationValues
        });
        processedAsins.add(parentAsin);
        console.log(`Successfully processed parent ASIN: ${parentAsin}`);
    }
  }

  // Calculate total variants
  const totalVariants = (initialResult.product.variants?.length || 0) + 1;
  let counter = 1;

  // Process initial ASIN if it's not the parent
  if (!processedAsins.has(initialAsin)) {
    console.log(`Processing initial ASIN (${counter}/${totalVariants}): ${initialAsin}`);

    const initialVariationValues = {};
    
    // First, initialize all known variation types
    Array.from(variationTypes).forEach(type => {
        initialVariationValues[type] = '';
    });
    
    // Then try to get specific values for this ASIN
    if (initialResult.product.variants) {
        console.log('Checking variants for initial ASIN data...');
        const thisVariant = initialResult.product.variants.find(v => v.asin === initialAsin);
        if (thisVariant && thisVariant.dimensions) {
            thisVariant.dimensions.forEach(dim => {
                initialVariationValues[dim.name] = dim.value;
            });
        }

        // If we didn't find the specific variant, check all variants for this ASIN's values
        if (!thisVariant) {
            initialResult.product.variants.forEach(variant => {
                if (variant.asin === initialAsin && variant.dimensions) {
                    variant.dimensions.forEach(dim => {
                        initialVariationValues[dim.name] = dim.value;
                    });
                }
            });
        }
    }

    // Also check direct dimensions
    if (initialResult.product.dimensions && typeof initialResult.product.dimensions === 'object') {
        Object.entries(initialResult.product.dimensions).forEach(([name, value]) => {
            if (typeof value === 'string') {
                initialVariationValues[name] = value;
            }
        });
    }

    const initialTitle = normalizeTitle(initialResult.product.title);
    const isDefaultChild = 
        normalizeTitle(initialResult.product.title) === parentTitle || 
        normalizeTitle(initialResult.product.title_excluding_variant_name) === parentTitleExcludingVariant;
    console.log(`\nComparing titles for default child check (${initialAsin}):
    Full Title Match:
      Parent: "${parentTitle}"
      This:   "${normalizeTitle(initialResult.product.title)}"
    Excluding Variant Match:
      Parent: "${parentTitleExcludingVariant}"
      This:   "${normalizeTitle(initialResult.product.title_excluding_variant_name)}"
    Is Default: ${isDefaultChild}`);

    results.push({
        asin: initialAsin,
        parentAsin: parentAsin,
        category: initialResult.product.categories_flat || initialResult.product.search_alias?.title || '',
        title: initialResult.product.title,
        title_excluding_variant_name: initialResult.product.title_excluding_variant_name || initialResult.product.title,
        type: initialAsin === parentAsin ? 'PARENT' : (isDefaultChild ? 'DEFAULT CHILD' : 'CHILD'),
        variationValues: initialVariationValues
    });
    processedAsins.add(initialAsin);
    counter++;
  }

  // Process remaining variants
  if (initialResult.product.variants) {
    for (const variant of initialResult.product.variants) {
      if (!processedAsins.has(variant.asin)) {
        console.log(`Processing variant (${counter}/${totalVariants}): ${variant.asin}`);
        const variantResult = await scrapeAmazon(variant.asin);
        
        if (variantResult && variantResult.product) {
          const variationValues = {};
          // Get variation values from dimensions
          if (variantResult.product.dimensions && Array.isArray(variantResult.product.dimensions)) {
            variantResult.product.dimensions.forEach(dim => {
              variationValues[dim.name] = dim.value;
              variationTypes.add(dim.name);
            });
          } else if (variantResult.product.dimensions && typeof variantResult.product.dimensions === 'object') {
            Object.entries(variantResult.product.dimensions).forEach(([name, value]) => {
              variationValues[name] = value;
              variationTypes.add(name);
            });
          }
          // Also check the variant dimensions from the initial result
          if (variant.dimensions) {
            variant.dimensions.forEach(dim => {
              variationValues[dim.name] = dim.value;
              variationTypes.add(dim.name);
            });
          }

          const variantTitle = normalizeTitle(variantResult.product.title);
          const isDefaultChild = 
              normalizeTitle(variantResult.product.title) === parentTitle || 
              normalizeTitle(variantResult.product.title_excluding_variant_name) === parentTitleExcludingVariant;
          console.log(`\nComparing titles for variant default child check (${variant.asin}):
          Full Title Match:
            Parent: "${parentTitle}"
            This:   "${normalizeTitle(variantResult.product.title)}"
          Excluding Variant Match:
            Parent: "${parentTitleExcludingVariant}"
            This:   "${normalizeTitle(variantResult.product.title_excluding_variant_name)}"
          Is Default: ${isDefaultChild}`);

          results.push({
            asin: variant.asin,
            parentAsin: variantResult.product.parent_asin,
            category: variantResult.product.categories_flat || variantResult.product.search_alias?.title || '',
            title: variantResult.product.title,
            title_excluding_variant_name: variantResult.product.title_excluding_variant_name || variantResult.product.title,
            type: variant.asin === parentAsin ? 'PARENT' : (isDefaultChild ? 'DEFAULT CHILD' : 'CHILD'),
            variationValues: variationValues
          });
        }
        processedAsins.add(variant.asin);
        counter++;
      }
    }
  }

  // Create CSV output
  const variationTypeArray = Array.from(variationTypes);
  const now = new Date();
  const timestamp = now.getFullYear().toString().slice(-2) + 
                   (now.getMonth() + 1).toString().padStart(2, '0') + 
                   now.getDate().toString().padStart(2, '0') + '_' +
                   now.getHours().toString().padStart(2, '0') + ':' +
                   now.getMinutes().toString().padStart(2, '0') + ':' +
                   now.getSeconds().toString().padStart(2, '0');

  const filename = `${timestamp}_${initialAsin}.xlsx`;

  // Convert results to worksheet data
  const worksheetData = [
      // Header row
      ['ASIN', 'Parent ASIN', 'Category', 'Title', 'Title Excluding Variant', 'Relationship', ...variationTypeArray]
  ];

  // Add data rows
  results.forEach(result => {
      const row = [
          result.asin,
          result.parentAsin,
          result.category,
          result.title,
          result.title_excluding_variant_name,
          result.type
      ];
      
      // Add variation values
      variationTypeArray.forEach(varType => {
          row.push(result.variationValues[varType] || '');
      });
      
      worksheetData.push(row);
  });

  try {
      // Create workbook and worksheets
      const workbook = new ExcelJS.Workbook();
      const variantSheet = workbook.addWorksheet('Variant Analysis');
      const attributeSheet = workbook.addWorksheet('Attribute Analysis');
      
      // First sheet - remains the same
      worksheetData.forEach(row => {
          variantSheet.addRow(row);
      });
      
      // Auto-size columns for first sheet
      variantSheet.columns.forEach((column, index) => {
          let maxLength = 0;
          variantSheet.getColumn(index + 1).eachCell({ includeEmpty: true }, cell => {
              const columnLength = cell.value ? cell.value.toString().length : 0;
              maxLength = Math.max(maxLength, columnLength);
          });
          column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      });

      // Second sheet - Attribute Analysis
      // Create headers and collect ASINs for each attribute-value combination
      const attributeValueColumns = new Map();
      
      // First pass: collect all attribute-value combinations and their ASINs
      results.forEach(result => {
          variationTypeArray.forEach(varType => {
              const value = result.variationValues[varType] || '';
              if (value) {
                  const columnHeader = `${varType}: ${value}`;
                  if (!attributeValueColumns.has(columnHeader)) {
                      attributeValueColumns.set(columnHeader, new Set());
                  }
                  attributeValueColumns.get(columnHeader).add(result.asin);
              }
          });
      });

      // Convert to array for easier handling
      const headers = Array.from(attributeValueColumns.keys());
      
      // Add headers to sheet
      attributeSheet.getRow(1).values = [''].concat(headers);

      // Find the maximum number of ASINs in any column
      const maxAsins = Math.max(...Array.from(attributeValueColumns.values(), set => set.size));

      // Add ASINs under each column
      for (let row = 2; row <= maxAsins + 1; row++) {
          const rowData = [''];  // First column empty
          headers.forEach(header => {
              const asins = Array.from(attributeValueColumns.get(header));
              rowData.push(asins[row - 2] || '');  // Add ASIN or empty string if no more ASINs
          });
          attributeSheet.getRow(row).values = rowData;
      }

      // Auto-size columns for second sheet
      attributeSheet.columns.forEach((column, index) => {
          let maxLength = 0;
          attributeSheet.getColumn(index + 1).eachCell({ includeEmpty: true }, cell => {
              const columnLength = cell.value ? cell.value.toString().length : 0;
              maxLength = Math.max(maxLength, columnLength);
          });
          column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      });
      
      // Add some basic formatting
      const headerRow = attributeSheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      
      // Save workbook to file
      await workbook.xlsx.writeFile(filename);
      
      console.log(`\nCompleted processing all ${results.length} variants!`);
      console.log(`Variant relationship analysis written to ${filename}`);
      console.log(`Found ${variationTypeArray.length} variation types: ${variationTypeArray.join(', ')}`);
  } catch (error) {
      console.error('Error writing analysis results:', error);
  }
}

// Helper function to normalize titles
function normalizeTitle(title) {
    return (title || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Add new function to scrape store categories
async function scrapeStoreCategory(categoryUrl) {
    try {
        const storeId = categoryUrl.split('/page/')[1].split('/')[0];
        const params = {
            api_key: "939D2F2E4B4746AE8E4B6BC407C14238",
            amazon_domain: "amazon.com",
            store_id: storeId,
            type: "store"
        };

        const response = await axios.get('https://api.rainforestapi.com/request', { params });
        return response.data.store_results || [];
    } catch (error) {
        console.error(colors.red + `Error scanning category: ${error.message}` + colors.reset);
        return [];
    }
}

// Add function to deduplicate ASINs with logging
async function deduplicateAsins(asins) {
    console.log(colors.cyan + `\n🔍 Starting deduplication process...` + colors.reset);
    console.log(colors.cyan + `Initial count: ${asins.length} ASINs` + colors.reset);
    
    // Create frequency map
    const frequency = asins.reduce((acc, asin) => {
        acc[asin] = (acc[asin] || 0) + 1;
        return acc;
    }, {});
    
    // Find duplicates
    const duplicates = Object.entries(frequency)
        .filter(([_, count]) => count > 1)
        .map(([asin, count]) => ({ asin, count }));
    
    // Log duplicate information
    if (duplicates.length > 0) {
        console.log(colors.yellow + `\nFound duplicates:` + colors.reset);
        duplicates.forEach(({ asin, count }) => {
            console.log(colors.yellow + `ASIN ${asin}: appears ${count} times` + colors.reset);
        });
    }
    
    // Get unique ASINs
    const uniqueAsins = Object.keys(frequency).sort();
    
    // Log statistics
    const totalDuplicates = asins.length - uniqueAsins.length;
    console.log(colors.green + `\nDeduplication complete:` + colors.reset);
    console.log(colors.green + `- Original count: ${asins.length}` + colors.reset);
    console.log(colors.green + `- Duplicate entries removed: ${totalDuplicates}` + colors.reset);
    console.log(colors.green + `- Final unique count: ${uniqueAsins.length}` + colors.reset);
    
    return uniqueAsins;
}

// Modified store scanning function
async function scrapeStore(storeId) {
    const params = {
        api_key: "939D2F2E4B4746AE8E4B6BC407C14238",
        amazon_domain: "amazon.com",
        store_id: storeId,
        type: "store"
    };

    try {
        console.log(colors.cyan + '🔍 Scanning main store page...' + colors.reset);
        const response = await axios.get('https://api.rainforestapi.com/request', { params });
        
        // Collect all ASINs from main page and categories
        let allProducts = [];
        let categoryCount = 0;
        let totalCategories = 0;

        // Add main page products
        if (response.data.store_results) {
            allProducts = allProducts.concat(
                response.data.store_results.map(item => item.asin)
            );
            console.log(colors.cyan + `Found ${response.data.store_results.length} products on main page` + colors.reset);
        }

        // Get unique categories (excluding duplicates and special pages)
        if (response.data.categories) {
            const uniqueCategories = new Set();
            response.data.categories.forEach(category => {
                if (category.link && 
                    !category.link.includes('/feed') && 
                    category.name !== 'Home' && 
                    category.name !== 'Posts') {
                    uniqueCategories.add(category.link);
                }
            });

            totalCategories = uniqueCategories.size;
            console.log(colors.cyan + `📂 Found ${totalCategories} categories to scan` + colors.reset);

            // Prompt user to continue
            const continueScanning = await new Promise((resolve) => {
                rl.question(colors.yellow + `Continue scanning ${totalCategories} categories? (y/n): ` + colors.reset, 
                    answer => resolve(answer.toLowerCase() === 'y'));
            });

            if (continueScanning) {
                // Scan each category
                for (const categoryUrl of uniqueCategories) {
                    categoryCount++;
                    console.log(colors.cyan + `\n📂 Scanning category ${categoryCount}/${totalCategories}...` + colors.reset);
                    
                    const categoryProducts = await scrapeStoreCategory(categoryUrl);
                    allProducts = allProducts.concat(
                        categoryProducts.map(item => item.asin)
                    );
                    
                    console.log(colors.green + `✅ Category ${categoryCount}/${totalCategories} complete - Found ${categoryProducts.length} products` + colors.reset);
                    
                    // Add a small delay between requests
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        // Deduplicate ASINs
        const uniqueAsins = await deduplicateAsins(allProducts);
        
        // Prompt user before proceeding with batch processing
        const continueBatch = await new Promise((resolve) => {
            rl.question(colors.yellow + `\nProceed with parent ASIN analysis for ${uniqueAsins.length} products? (y/n): ` + colors.reset, 
                answer => resolve(answer.toLowerCase() === 'y'));
        });

        if (continueBatch) {
            return uniqueAsins.join(',');
        } else {
            console.log(colors.cyan + '⏭️ Skipping batch processing' + colors.reset);
            return '';
        }

    } catch (error) {
        console.error(colors.red + 'Error scanning store:', error.message + colors.reset);
        return '';
    }
}

// Main execution
console.log('Amazon Product Scraper');
console.log('---------------------');

// Initialize database
initializeDatabase();

async function mainLoop() {
    while (true) {
        console.log('\nOptions:');
        console.log('1. Batch process multiple ASINs');
        console.log('2. Batch process by parent ASIN');
        console.log('3. Analyze variant relationships');
        console.log('4. Scan store');
        console.log('5. Exit');
        console.log('---------------------');
        
        const answer = await new Promise((resolve) => {
            rl.question('Please select an option (1-5): ', resolve);
        });

        switch (answer) {
            case '1':
                const inputAsins = await new Promise((resolve) => {
                    rl.question('Enter ASINs (separated by commas or newlines): ', resolve);
                });
                console.log('Starting batch processing...');
                await batchProcess(inputAsins);
                break;

            case '2':
                const parentInputAsins = await new Promise((resolve) => {
                    rl.question('Enter ASINs (separated by commas or newlines): ', resolve);
                });
                console.log('Starting parent ASIN processing...');
                await batchProcessByParent(parentInputAsins);
                break;

            case '3':
                const input = await new Promise((resolve) => {
                    rl.question('Enter store ID or ASIN: ', resolve);
                });
                
                const trimmedInput = input.trim();
                
                // Check if input is a store ID or ASIN
                const isStoreId = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(trimmedInput);
                const isAsin = /^[A-Z0-9]{10}$/.test(trimmedInput);
                
                if (isStoreId) {
                    // Handle store ID
                    console.log(colors.cyan + '🔍 Scanning store...' + colors.reset);
                    const storeAsins = await scrapeStore(trimmedInput);
                    
                    if (storeAsins) {
                        console.log(colors.cyan + '🏃 Processing store ASINs...' + colors.reset);
                        await batchProcessByParent(storeAsins);
                    }
                } else if (isAsin) {
                    // Handle ASIN
                    console.log(colors.cyan + '🔍 Fetching product data...' + colors.reset);
                    const result = await scrapeAmazon(trimmedInput);
                    
                    if (result && result.product && result.product.brand_store) {
                        const storeId = result.product.brand_store.id;
                        console.log(colors.green + `✅ Found store ID: ${storeId}` + colors.reset);
                        
                        const proceed = await new Promise((resolve) => {
                            rl.question(colors.yellow + `Proceed with scanning store ${storeId}? (y/n): ` + colors.reset, 
                                answer => resolve(answer.toLowerCase() === 'y'));
                        });
                        
                        if (proceed) {
                            console.log(colors.cyan + '🔍 Scanning store...' + colors.reset);
                            const storeAsins = await scrapeStore(storeId);
                            
                            if (storeAsins) {
                                console.log(colors.cyan + '🏃 Processing store ASINs...' + colors.reset);
                                await batchProcessByParent(storeAsins);
                            }
                        }
                    } else {
                        console.log(colors.red + '❌ Could not find store ID for this ASIN' + colors.reset);
                    }
                } else {
                    console.log(colors.red + '❌ Invalid input. Please enter either a valid store ID or ASIN' + colors.reset);
                }
                break;

            case '4':
                const storeInput = await new Promise((resolve) => {
                    rl.question('Enter store ID or ASIN: ', resolve);
                });
                
                const trimmedStoreInput = storeInput.trim();
                const isStoreIdFormat = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(trimmedStoreInput);
                const isAsinFormat = /^[A-Z0-9]{10}$/.test(trimmedStoreInput);
                
                if (isStoreIdFormat) {
                    console.log(colors.cyan + '🔍 Scanning store...' + colors.reset);
                    const storeAsins = await scrapeStore(trimmedStoreInput);
                    
                    if (storeAsins) {
                        console.log(colors.cyan + '🏃 Processing store ASINs...' + colors.reset);
                        await batchProcessByParent(storeAsins);
                    }
                } else if (isAsinFormat) {
                    console.log(colors.cyan + '🔍 Fetching product data...' + colors.reset);
                    const result = await scrapeAmazon(trimmedStoreInput);
                    
                    if (result && result.brand_store) {
                        const storeId = result.brand_store.id;
                        if (storeId) {
                            console.log(colors.green + `✅ Found store ID: ${storeId}` + colors.reset);
                            
                            const proceed = await new Promise((resolve) => {
                                rl.question(colors.yellow + `Proceed with scanning store ${storeId}? (y/n): ` + colors.reset, 
                                    answer => resolve(answer.toLowerCase() === 'y'));
                            });
                            
                            if (proceed) {
                                console.log(colors.cyan + '🔍 Scanning store...' + colors.reset);
                                const storeAsins = await scrapeStore(storeId);
                                
                                if (storeAsins) {
                                    console.log(colors.cyan + '🏃 Processing store ASINs...' + colors.reset);
                                    await batchProcessByParent(storeAsins);
                                }
                            }
                        } else {
                            console.log(colors.red + '❌ Store ID not found in brand_store object' + colors.reset);
                        }
                    } else {
                        console.log(colors.red + '❌ No brand_store data found in response' + colors.reset);
                    }
                } else {
                    console.log(colors.red + '❌ Invalid input. Please enter either a valid store ID or ASIN' + colors.reset);
                }
                break;

            case '5':
                console.log('\nThank you for using the Amazon Product Scraper!');
                db.close();
                rl.close();
                return;

            default:
                console.log('Invalid option. Please try again.');
        }
    }
}

// Start the program
mainLoop().catch(error => {
    console.error('An error occurred:', error);
    db.close();
    rl.close();
});

// Handle cleanup when the program exits
rl.on('close', () => {
    process.exit(0);
});