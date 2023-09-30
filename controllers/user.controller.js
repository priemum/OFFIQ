require('dotenv').config();
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer')
const crypto = require('crypto');  //encription module
router.use(express.json());

//modals
const User = require('../models/user.models'); //user schema
const Products = require('../models/productModel'); //products schema
const Category = require('../models/categoryModel'); //category schema
const Order = require('../models/order.model'); //order schema
const googelUser = require('../models/emailUserModel');//schema for google auth users

//keys
const algorithm = 'aes-256-cbc';
const key = process.env.ENCRIPTION_KEY;
const iv = 'initialisation-#';

//encription function
function encrypt(text, key) {
  try {
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  } catch (error) {
    console.log(error);
  }
}
//decrypting function
function decrypt(encryptedText, key) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}


//generate OTP
function generateOTP() {
  const expirationTime = new Date();
  expirationTime.setMinutes(expirationTime.getMinutes() + 10);//set 10 minutes as expiry
  // Generate a 6 digit number as OTP
  let otp = crypto.randomBytes(3).toString('hex')
  return { otp, expirationTime }
}


//sending OTP through mail
const sendOTP = async (name, email, otp) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      port: 587,
      secure: false,
      requireTLS: true,
      host: 'smtp.gmail.com',
      auth: {
        user: 'eatables.bitdrag@gmail.com',
        pass: process.env.SMTP_KEY
      }
    });
    let info = await transporter.sendMail({
      from: 'eatables.bitdrag@gmail.com',
      to: `${email}`,
      subject: 'OTP for verification',
      html: `<h1>Hy ${name}</h1><br><p>Your OTP for the verification is <h2>${otp}</h2></p>`,
    });

  } catch (error) {
    console.log(error);
  }
}

//verification of otp
async function verifyOTP(email, otp) {
  const user = await User.findOne({ email: email },{addresses:0,cart:0,wishlist:0});
  if (user && otp === decrypt(user.otp, key) && Date.now() <= user.otpExpires) {
    user.verified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    return { status: true, user };
  }
  return { status: false }
}

//deletion of data when email is unverified
async function deleteUnverifiedDocs() {
  const tenMinutesAgo = new Date(Date.now() - 600000); // 600000 milliseconds is 10 minutes
  try {
    const deleted = await User.deleteMany({ verified: false, createdAt: { $lt: tenMinutesAgo } })
    console.log(`Deleted ${deleted.deletedCount} documents.`);
  } catch (error) {
    console.error(err);
  }

}

const userController = {
  //login of the user
  userLogin: async (req, res) => {
    const { email, password } = req.body;//data given by the user
    try {
      const user = await User.findOne({ email },{addresses:0,cart:0,wishlist:0});
      if (user != null) {//data from the DB
        if (!(user.googleAuth) && decrypt(user.password, key) === password && !(user.blocked)) {
          req.session.user = user;
          console.log(user.fullname + ' logged in');
          return res.redirect('/');
        } else if (user.blocked) {
          req.session.block = true;
          return res.redirect('/login');
        } else {
          req.session.err = true;
          return res.redirect('/login');
        }
      } else {
        req.session.err = true;
        return res.redirect('/login');
      }

    } catch (err) {
      console.log(err);
      return res.status(500).send('Error fetching user data');
    }
  },
  forgotPage: (req, res) => {
    return res.render('forgotPassword')
  },

  forgotPassword: async (req, res) => {
    try {
      let { otp, expirationTime } = generateOTP();
      let email = req.body.email


      const user = await User.findOne({ email })//inserting the data

      if (user) {
        let data = {}
        data.otp = encrypt(otp, key)
        data.otpExpires = expirationTime
        const update = await User.updateOne({ email }, { $set: { otp: data.otp, otpExpires: data.otpExpires } }) //updating the data

        const need = "forgotPassword"

        sendOTP(user.fullname, email, otp)
        return res.render('otpVerify', { email: email, need: need, error: '' })
      }

    } catch (err) {
      console.log(err);
      return res.status(500).send('Error creating USER');
    }

  },
  updatePassword: async (req, res) => {
    try {
      const { email, password } = req.body
      const hashPassword = encrypt(password, key)
      const update = await User.updateOne({ email: email }, { $set: { password: hashPassword } }) //updateing the data
      console.log("password updated");
      return res.redirect('/')
    } catch (error) {
      console.log(error);
    }
  },

  //render signup page
  signUp: (req, res) => {
    return res.render('signup');
  },


  //user signUp
  userSignup: async (req, res) => {
    try {
      const data = req.body;//data given by the user
      const email = data.email
      const user = await User.findOne({ email });
      if (user) {
        return res.json("Email already exist") //update this section
      } else {
        data.password = encrypt(data.password, key);//encripting the password
        try {
          let { otp, expirationTime } = generateOTP();
          data.otp = encrypt(otp, key)
          data.otpExpires = expirationTime
          const user = await User.create(data) //inserting the data
          sendOTP(user.fullname, user.email, otp)
          setInterval(deleteUnverifiedDocs, 600000);
          const need = "userSignIN"

          return res.render('otpVerify', { email: user.email, need: need, error: '' })

        } catch (err) {
          console.log(err);
          return res.status(500).send('Error creating USER');
        }
      }

    } catch (error) {
      console.log(error);
    }

  },

  //email verification
  emailVerify: async (req, res) => {
    try {
      const { otp, email, need } = req.body
      const { status, user } = await verifyOTP(email, otp)
      if (status) { //setting value to the session
        if (need == "userSignIN") {
          req.session.user = user;
          console.log(user.fullname + ' logged in');
          return res.redirect('/');
        }
        else {
          return res.render('newPassword', { email });
        }
      }
      else {
        if (need == "userSignIN") {
          return res.render('otpVerify', { email: email, need: "userSignIN", error: '' })
        } else {
          return res.render('otpVerify', { email: email, need: "forgotPassword", error: '' })

        }

      }
    } catch (error) {
      console.log(error);
    }
  },

  resend: async (req, res) => {
    // const tenMinutesAgo = new Date(Date.now() - 0); // 600000 milliseconds is 10 minutes
    try {
      let { otp, expirationTime } = generateOTP();
      const email = req.query.email
      sendOTP("Resend", email, otp)
      otp = encrypt(otp, key)
      const user = await User.updateOne({ email }, { $set: { otp: otp, otpExpires: expirationTime } }) //inserting the data
      const need = "forgotPassword"
      return res.render('otpVerify', { email: email, need: need, error: 'New OTP send' })
    } catch (error) {
      console.error(error);
    }
  },
  //error in login
  loginErr: (req, res) => {
    try {
      if (req.session.user) {
        return res.redirect('/');
      } else if (req.session.block) {
        return res.render('login', { errorMessage: 'User account has been blocked by the admin' });
      }
      else if (req.session.err) {
        req.session.err = false;
        // Pass an error message to the login view
        return res.render('login', { errorMessage: 'Incorrect email or password' });
      } else {
        return res.render('login', { errorMessage: '' });
      }

    } catch (error) {
      console.log(error);
    }
  },

  //rendering the home page
  home: async(req, res) => {
    let category = await Category.find({});

    return res.render('home', { category: category });
  },

  //render products view page
  products: async (req, res) => {
    try {
      const cId=req.params.id
      const products = await Products.find({category:cId});
      let category = await Category.find({_id:cId});
      return res.render('products', { products: products, category: category });
    } catch (error) {
      console.log(error);
    }
  },

  //render product page
  productPage: async (req, res) => {
    try {
      const ID = req.params.id;
      const user = req.session.user
      const product = await Products.findOne({ '_id': ID });
      return res.render('productView', { product: product, user: user });
    } catch (error) {
      console.log(error);
    }

  },

  // user cart
  cart: async (req, res) => {
    try {
      const userId = req.session.user._id;
      if (!userId) {
        return res.redirect('/')
      }
      const user = await User.findOne({ _id: userId }, { cart: 1 });
      const cart = user.cart;
      const products = [];

      for (const prod of cart) {
        try {
          const item = await Products.findById(prod.productId);
          if (item) {
            products.push(item);
          } else {
            // Handle the case where a product with the given ID is not found
            console.log(`Product not found for ID: ${prod.productId}`);
          }
        } catch (error) {
          // Handle any errors that occur during product fetching
          console.error(`Error fetching product: ${error}`);
        }
      }
      return res.render('cart', { cart: cart, products: products, msg: '' });
    } catch (error) {
      console.log(error);
    }


  },

  // add to cart
  addToCart: async (req, res) => {
    try {
      const { productId, quantity } = req.body;
      const userId = req.session.user._id;


      if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }
      const updatedProduct = await Products.findOne(
        { _id: productId, quantity: { $gte: quantity } },
        // { $inc: { quantity: -quantity } }, update the quantity
        { new: true }
      );

      if (!updatedProduct) {
        return res.status(204).json({ message: 'Product out of stock' });
      }
      const user = await User.findById(userId);
      if (user.googleAuth) {//for googlE aUTH USERS
        const gUser = await googelUser.findById(userId);
        // Find the user and update the cart
        const existingCartItemIndex = gUser.cart.findIndex(item => item.productId.equals(productId));
        if (existingCartItemIndex !== -1) {
          // Cart item with the same productId exists, update its quantity
          gUser.cart[existingCartItemIndex].quantity += Number(quantity);
        } else {
          // Cart item with the same productId doesn't exist, add a new item
          gUser.cart.push({ productId, quantity });
        }

        // Save the updated user document
        await gUser.save();
      } else {
        // Find the user and update the cart

        const existingCartItemIndex = user.cart.findIndex(item => item.productId.equals(productId));
        if (existingCartItemIndex !== -1) {
          // Cart item with the same productId exists, update its quantity
          user.cart[existingCartItemIndex].quantity += Number(quantity);
        } else {
          // Cart item with the same productId doesn't exist, add a new item
          user.cart.push({ productId, quantity });
        }
        // Save the updated user document
        await user.save();
      }
      return res.status(200).json({ message: 'Item added to cart' });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },

  // remove product from the cart
  removeProduct: async (req, res) => {
    try {
      const userId = req.session.user._id;
      const pId = req.params.id
      const status = await User.findByIdAndUpdate(
        userId,
        { $pull: { cart: { productId: pId } } }
      );


      if (status) {
        return res.status(200).redirect('/cart')
      }
    } catch (error) {
      console.log(error);
    }

  },

  //update the cart
  updateCart: async (req, res) => {
    try {
      const pId = req.body.itemId
      const userId = req.session.user._id
      const quantity = req.body.amount;

      const result = await User.updateOne(
        {
          _id: userId,
          'cart.productId': pId, // Match the product id in the user's cart
        },
        {
          $set: {
            'cart.$.quantity': quantity, // Update the quantity for the matched product
          },
        }

      );
      if (result.nModified === 0) {

        return res.status(200).json({ message: 'No documents were updated' });

      } else {
        return res.status(200).json({ message: 'Document updated successfully' });

      }

    } catch (error) {
      console.log(error);
    }
  },

  //checkout page
  checkOut: async (req, res) => {
    try {
      const userId = req.session.user._id;
      if (!userId) {
        return res.redirect('/')
      }
      const user = await User.findOne({ _id: userId }, { cart: 1, addresses: 1 });
      const addresses = user.addresses
      const cart = user.cart;

      const products = [];
      for (const prod of cart) {
        try {
          const item = await Products.findById(prod.productId);
          if (item) {
            products.push(item);
          } else {
            //  product with the given ID is not found
            console.log(`Product not found for ID: ${prod.productId}`);
          }
        } catch (error) {
          // Handle any errors that occur during product fetching
          console.error(`Error fetching product: ${error}`);
        }
      }
      // return res.json({cart,  products,addresses})
      return res.render('checkout', { cart: cart, products: products, address: addresses });
    } catch (error) {
      console.log(error);
    }
  },
  addAddress: async (req, res) => {
    try {
      const { addressLine1, city, tag } = req.body
      let { pin } = req.body
      pin = Number(pin)
      const data = { addressLine1, city, tag, pin }
      console.log(data);
      const userId = req.session.user._id;
      const user = await User.findById(userId)
      if (user.googleAuth) {//for googlE aUTH USERS
        const gUser = await googelUser.findById(userId);
        gUser.addresses.push(data)
        gUser.save()
      }else{
        user.addresses.push(data)
        user.save()
      }
      return res.redirect('back')
    } catch (error) {
      console.log(error);
    }
  },
  // order
  order: async (req, res) => {
    try {
      const userId = req.session.user._id;
      const paymentId = crypto.randomBytes(3).toString('hex')
      const status = 'pending'
      const user = await User.findOne({ _id: userId }, { cart: 1, addresses: 1 });
      const items = user.cart;

      const { total, address, paymentMode } = req.body
      const shippingAddress = user.addresses.find(addr => addr.tag == address)
      const data = { userId, paymentId, status, items, total, shippingAddress, paymentMode }
      const result = await Order.create(data)
      items.forEach(async (prod) => {
        let updatedProduct = await Products.findOneAndUpdate(
          { _id: prod.productId },
          { $inc: { quantity: -prod.quantity } }, //update the quantity
          { new: true }
        );

      });
      let updatedCart = await User.findOneAndUpdate(
        { _id: userId },
        { $set: { cart: [] } }, //update the cart
        { new: true }
      );
      return res.render('cart', { cart: [], products: [], msg: 'ORDER SUCCESFULLY PLACED' });
    } catch (error) {
      console.log(error);
    }
  },

  orderManagement: async (req, res) => {
    try {
      const order = await Order.find({});

      let products = []
      for (const ord of order) {
        for (const prod of ord.items) {
          try {
            const item = await Products.findById(prod.productId);

            if (item) {
              // Check if product already exists in the array
              const productExists = products.some(product => product._id.toString() === item._id.toString());

              // If product does not exist in the array, push it
              if (!productExists) {
                products.push(item);
              }
            } else {
              console.log(`Product not found for ID: ${prod.productId}`);
            }
          } catch (error) {
            console.error(`Error fetching product: ${error}`);
          }
        }
      }
      console.log(products);
      return res.render('orderManagement', { order: order, products: products })

    } catch (error) {
      console.log(error);
    }
  },

  userProfile:async (req, res) => {
    try {
      const userId = req.session.user._id;
      const user = await User.findOne({ _id: userId });
      
      const addresses = user.addresses
      const order = await Order.find({userId});

      let products = []
      for (const ord of order) {
        for (const prod of ord.items) {
          try {
            const item = await Products.findById(prod.productId);

            if (item) {
              // Check if product already exists in the array
              const productExists = products.some(product => product._id.toString() === item._id.toString());

              // If product does not exist in the array, push it
              if (!productExists) {
                products.push(item);
              }
            } else {
              console.log(`Product not found for ID: ${prod.productId}`);
            }
          } catch (error) {
            console.error(`Error fetching product: ${error}`);
          }
        }
      }
      return res.render('user', { order: order, products: products ,user:user})

    } catch (error) {
      console.log(error);
    }
  },
  cancelOrder:async(req,res)=>{
    try {
      const oId=req.body.oId
      const status=req.body.status
      console.log(status,oId);
      const update=await Order.findByIdAndUpdate(oId,{$set:{status:status}})
      return
    } catch (error) {
      console.log(error);
    }
  },
  //logout the user
  logout: (req, res) => {
    if (req.session.user) {
      console.log(`${req.session.user.fullname} logged out`);
    }
    req.session.destroy(); // Destroy session on logout
    return res.redirect('/');
  }


}
module.exports = userController;
