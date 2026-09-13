require("dotenv").config();

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

app.get("/businesses", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("businesses")
      .select("*");

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// ==============================
// PRODUCTS API
// ==============================

// Get all products
app.get("/api/products", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Add a product
app.post("/api/products", async (req, res) => {
  try {
    const {
      business_id,
      name,
      sku,
      category,
      unit,
      purchase_price,
      selling_price,
      stock_quantity,
      low_stock_alert,
    } = req.body;

    if (!business_id || !name) {
      return res.status(400).json({
        success: false,
        error: "business_id and name are required",
      });
    }

    const { data, error } = await supabase
      .from("products")
      .insert({
        business_id,
        name,
        sku: sku || null,
        category: category || null,
        unit: unit || "pcs",
        purchase_price: purchase_price || 0,
        selling_price: selling_price || 0,
        stock_quantity: stock_quantity || 0,
        low_stock_alert: low_stock_alert || 0,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
app.use(express.static("public"));
// ==============================
// SALES API
// ==============================

app.post("/api/sales", async (req, res) => {
  try {
   const { product_id, quantity, paid_amount, customer_name, customer_phone } = req.body;

    const qty = Number(quantity);

    if (!product_id || !qty || qty < 1) {
      return res.status(400).json({
        success: false,
        error: "সঠিক পণ্য ও পরিমাণ দিন"
      });
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select(
        "id, business_id, name, purchase_price, selling_price, stock_quantity"
      )
      .eq("id", product_id)
      .single();

    if (productError || !product) {
      return res.status(400).json({
        success: false,
        error: productError?.message || "পণ্য পাওয়া যায়নি"
      });
    }

    const currentStock = Number(product.stock_quantity || 0);

    if (qty > currentStock) {
      return res.status(400).json({
        success: false,
        error: "পর্যাপ্ত স্টক নেই"
      });
    }

    const unitPrice = Number(product.selling_price || 0);
    const costPrice = Number(product.purchase_price || 0);
    const totalAmount = unitPrice * qty;
    const newStock = currentStock - qty;

    const invoiceNo = "INV-" + Date.now();
const paidAmount = Math.max(0, Math.min(Number(paid_amount || 0), totalAmount));
const dueAmount = totalAmount - paidAmount;
const paymentStatus = dueAmount === 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";   
let customerId = null;

const customerName = String(customer_name || "").trim();
const customerPhone = String(customer_phone || "").trim();

if (customerName || customerPhone) {
  let existingCustomer = null;

  if (customerPhone) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", product.business_id)
      .eq("phone", customerPhone)
      .maybeSingle();

    existingCustomer = data;
  }

  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const { data: newCustomer, error: customerError } = await supabase
      .from("customers")
      .insert({
        business_id: product.business_id,
        name: customerName || "নাম নেই",
        phone: customerPhone || null,
        opening_due: 0
      })
      .select("id")
      .single();

    if (customerError) {
      return res.status(400).json({
        success: false,
        error: customerError.message
      });
    }

    customerId = newCustomer.id;
  }
} 
// 1. Save sale
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        business_id: product.business_id,
        customer_id: customerId,
        invoice_no: invoiceNo,
        sale_date: new Date().toISOString(),
        subtotal: totalAmount,
        discount: 0,
        total_amount: totalAmount,
        paid_amount: paidAmount,
due_amount: dueAmount,
payment_status: paymentStatus
      })
      .select("id")
      .single();

    if (saleError) {
      return res.status(400).json({
        success: false,
        error: saleError.message
      });
    }

    // 2. Save sale item
    const { error: itemError } = await supabase
      .from("sale_items")
      .insert({
        business_id: product.business_id,
        sale_id: sale.id,
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        unit_price: unitPrice,
        cost_price: costPrice,
        line_total: totalAmount
      });

    if (itemError) {
      await supabase.from("sales").delete().eq("id", sale.id);

      return res.status(400).json({
        success: false,
        error: itemError.message
      });
    }

    // 3. Reduce stock
    const { error: updateError } = await supabase
      .from("products")
      .update({
        stock_quantity: newStock
      })
      .eq("id", product_id);

    if (updateError) {
      await supabase.from("sale_items").delete().eq("sale_id", sale.id);
      await supabase.from("sales").delete().eq("id", sale.id);

      return res.status(400).json({
        success: false,
        error: updateError.message
      });
    }

    res.json({
      success: true,
      data: {
        sale_id: sale.id,
        invoice_no: invoiceNo,
        product: product.name,
        quantity: qty,
        unit_price: unitPrice,
        total: totalAmount,
        stock_remaining: newStock
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// =============================
// SALES HISTORY API
// =============================
app.get("/api/sales-history", async (req, res) => {
  try {
    const { data: sales, error: salesError } = await supabase
      .from("sales")
      .select(`
        id,
        invoice_no,
        sale_date,
        subtotal,
        discount,
        total_amount,
        paid_amount,
        due_amount,
        payment_status
      `)
      .order("sale_date", { ascending: false });

    if (salesError) {
      return res.status(400).json({
        success: false,
        error: salesError.message
      });
    }

    const { data: items, error: itemsError } = await supabase
      .from("sale_items")
      .select(`
        sale_id,
        product_name,
        quantity,
        unit_price,
        line_total
      `);

    if (itemsError) {
      return res.status(400).json({
        success: false,
        error: itemsError.message
      });
    }

    const result = sales.map(sale => ({
      ...sale,
      items: items.filter(item => item.sale_id === sale.id)
    }));

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.post("/api/sales/:id/collect-due", async (req, res) => {
  try {
    const saleId = req.params.id;
    const amount = Number(req.body.amount || 0);

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "সঠিক টাকার পরিমাণ দিন"
      });
    }

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("*")
      .eq("id", saleId)
      .single();

    if (saleError || !sale) {
      return res.status(404).json({
        success: false,
        error: "বিক্রয়ের তথ্য পাওয়া যায়নি"
      });
    }

    const currentPaid = Number(sale.paid_amount || 0);
    const currentDue = Number(sale.due_amount || 0);

    if (amount > currentDue) {
      return res.status(400).json({
        success: false,
        error: "বাকি টাকার চেয়ে বেশি আদায় করা যাবে না"
      });
    }

    const newPaid = currentPaid + amount;
    const newDue = currentDue - amount;
    const newStatus = newDue <= 0 ? "paid" : "partial";

    const { data: updatedSale, error: updateError } = await supabase
      .from("sales")
      .update({
        paid_amount: newPaid,
        due_amount: newDue,
        payment_status: newStatus
      })
      .eq("id", saleId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: updatedSale
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/customers-summary", async (req, res) => {
  try {
    const { data: customers, error: customerError } = await supabase
      .from("customers")
      .select("id, name, phone, opening_due")
      .order("created_at", { ascending: false });

    if (customerError) throw customerError;

    const { data: sales, error: salesError } = await supabase
      .from("sales")
      .select("customer_id, total_amount, paid_amount, due_amount");

    if (salesError) throw salesError;

    const result = (customers || []).map(customer => {
      const customerSales = (sales || []).filter(
        sale => sale.customer_id === customer.id
      );

      const totalSales = customerSales.reduce(
        (sum, sale) => sum + Number(sale.total_amount || 0),
        0
      );

      const totalPaid = customerSales.reduce(
        (sum, sale) => sum + Number(sale.paid_amount || 0),
        0
      );

      const salesDue = customerSales.reduce(
        (sum, sale) => sum + Number(sale.due_amount || 0),
        0
      );

      const totalDue =
        salesDue + Number(customer.opening_due || 0);

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        total_sales: totalSales,
        total_paid: totalPaid,
        total_due: totalDue
      };
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.post("/api/customers/:id/collect-due", async (req, res) => {
  try {
    const customerId = req.params.id;
    const amount = Number(req.body.amount || 0);

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "সঠিক টাকার পরিমাণ দিন"
      });
    }

    const { data: sales, error: salesError } = await supabase
      .from("sales")
      .select("id, paid_amount, due_amount, payment_status, sale_date")
      .eq("customer_id", customerId)
      .gt("due_amount", 0)
      .order("sale_date", { ascending: true });

    if (salesError) throw salesError;

    const totalDue = (sales || []).reduce(
      (sum, sale) => sum + Number(sale.due_amount || 0),
      0
    );

    if (amount > totalDue) {
      return res.status(400).json({
        success: false,
        error: "মোট বাকি টাকার চেয়ে বেশি আদায় করা যাবে না"
      });
    }

    let remaining = amount;

    for (const sale of sales || []) {
      if (remaining <= 0) break;

      const saleDue = Number(sale.due_amount || 0);
      const salePaid = Number(sale.paid_amount || 0);

      const collectAmount = Math.min(remaining, saleDue);

      const newPaid = salePaid + collectAmount;
      const newDue = saleDue - collectAmount;
      const newStatus = newDue <= 0 ? "paid" : "partial";

      const { error: updateError } = await supabase
        .from("sales")
        .update({
          paid_amount: newPaid,
          due_amount: newDue,
          payment_status: newStatus
        })
        .eq("id", sale.id);

      if (updateError) throw updateError;

      remaining -= collectAmount;
    }
const { error: paymentHistoryError } = await supabase
  .from("due_payments")
  .insert({
    customer_id: customerId,
    sale_id: null,
    amount: amount
  });

if (paymentHistoryError) throw paymentHistoryError;

    res.json({
      success: true,
      collected: amount
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/due-payments", async (req, res) => {
  try {
    const { data: payments, error } = await supabase
      .from("due_payments")
      .select(`
        id,
        customer_id,
        sale_id,
        amount,
        created_at,
        customers (
          name,
         phone
        )
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: payments || []
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get("/api/purchases", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("purchases")
      .select("id, purchase_date, total_amount, paid_amount, due_amount, payment_status")
      .order("purchase_date", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/purchases", async (req, res) => {
  try {
    const total = Number(req.body.total_amount || 0);
    const paidInput = Number(req.body.paid_amount || 0);
    const notes = req.body.notes || null;

    if (total <= 0) {
      return res.status(400).json({
        success: false,
        error: "মোট ক্রয় মূল্য সঠিকভাবে দিন"
      });
    }

    const paid = Math.max(0, Math.min(paidInput, total));
    const due = total - paid;
    const paymentStatus =
      due === 0 ? "paid" : paid > 0 ? "partial" : "due";

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .limit(1)
      .single();

    if (businessError || !business) {
      throw businessError || new Error("Business পাওয়া যায়নি");
    }

    const { data: purchase, error } = await supabase
      .from("purchases")
      .insert({
        business_id: business.id,
        purchase_no: "PUR-" + Date.now(),
        purchase_date: new Date().toISOString(),
        total_amount: total,
        paid_amount: paid,
        due_amount: due,
        payment_status: paymentStatus,
        notes: notes
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: purchase
    });

  } catch (error) {
    console.error("PURCHASE ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==============================
// SUPPLIERS API
// ==============================

// সব Supplier দেখাবে
app.get("/api/suppliers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error("SUPPLIER GET ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// নতুন Supplier সংরক্ষণ করবে
app.post("/api/suppliers", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const phone = (req.body.phone || "").trim();
    const address = (req.body.address || "").trim();
    const openingDue = Number(req.body.opening_due || 0);

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Supplier-এর নাম লিখুন"
      });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .limit(1)
      .single();

    if (businessError || !business) {
      throw businessError || new Error("Business পাওয়া যায়নি");
    }

    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        business_id: business.id,
        name: name,
        phone: phone || null,
        address: address || null,
        opening_due: openingDue
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error("SUPPLIER POST ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==============================
// EXPENSES API
// ==============================

// সব খরচ দেখাবে
app.get("/api/expenses", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("expense_date", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error("EXPENSE GET ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// নতুন খরচ সংরক্ষণ করবে
app.post("/api/expenses", async (req, res) => {
  try {
    const category = req.body.category || "";
    const amount = Number(req.body.amount || 0);
    const expenseDate = req.body.expense_date;
    const notes = req.body.notes || null;

    if (!category) {
      return res.status(400).json({
        success: false,
        error: "খরচের ধরন নির্বাচন করুন"
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "টাকার পরিমাণ সঠিকভাবে দিন"
      });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .limit(1)
      .single();

    if (businessError || !business) {
      throw businessError || new Error("Business পাওয়া যায়নি");
    }

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        business_id: business.id,
        title: category, 
        category: category,
        amount: amount,
        expense_date: expenseDate,
        notes: notes
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error("EXPENSE POST ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==============================
// PAYMENTS API
// ==============================

// সব Payment দেখাবে
app.get("/api/payments", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .order("payment_date", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error) {
    console.error("PAYMENT GET ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// নতুন Payment সংরক্ষণ করবে
app.post("/api/payments", async (req, res) => {
  try {
    const paymentType = req.body.payment_type || "";
    const amount = Number(req.body.amount || 0);
    const paymentMethod = req.body.payment_method || "cash";
    const paymentDate = req.body.payment_date;
    const reference = req.body.reference || null;
    const notes = req.body.notes || null;

    if (!paymentType) {
      return res.status(400).json({
        success: false,
        error: "পেমেন্টের ধরন নির্বাচন করুন"
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "টাকার পরিমাণ সঠিকভাবে দিন"
      });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .limit(1)
      .single();

    if (businessError || !business) {
      throw businessError || new Error("Business পাওয়া যায়নি");
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        business_id: business.id,
        payment_type: paymentType,
        amount: amount,
        payment_method: paymentMethod,
        payment_date: paymentDate,
        reference: reference,
        notes: notes
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error("PAYMENT POST ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/purchases/:id/pay-due", async (req, res) => {
  try {
    const purchaseId = req.params.id;
    const amount = Number(req.body.amount || 0);

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "সঠিক টাকার পরিমাণ দিন"
      });
    }

    const { data: purchase, error: purchaseError } = await supabase
      .from("purchases")
      .select("id, paid_amount, due_amount")
      .eq("id", purchaseId)
      .single();

    if (purchaseError || !purchase) {
      throw purchaseError || new Error("ক্রয়ের তথ্য পাওয়া যায়নি");
    }

    const oldPaid = Number(purchase.paid_amount || 0);
    const oldDue = Number(purchase.due_amount || 0);

    if (oldDue <= 0) {
      return res.status(400).json({
        success: false,
        error: "এই ক্রয়ের কোনো বাকি নেই"
      });
    }

    if (amount > oldDue) {
      return res.status(400).json({
        success: false,
        error: "বাকির চেয়ে বেশি টাকা দেওয়া যাবে না"
      });
    }

    const newPaid = oldPaid + amount;
    const newDue = oldDue - amount;
    const newStatus = newDue === 0 ? "paid" : "partial";

    const { data, error } = await supabase
      .from("purchases")
      .update({
        paid_amount: newPaid,
        due_amount: newDue,
        payment_status: newStatus
      })
      .eq("id", purchaseId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error("PURCHASE DUE PAYMENT ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`HisabAI Server running on http://localhost:${PORT}`);
});

server.on("error", (error) => {
  console.error("SERVER ERROR:", error);
});