const Guest = require("../../models").guest;
const User = require("../../models").user;
const Cart = require("../../models").cart;
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const OTP = require("../../models").otp;
const Sequelize = require("sequelize");
const Op = Sequelize.Op;
const { sequelize } = require("../../models");
const moment = require("moment-timezone");

// Create a nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  secure: true,
  port: 465,
  auth: {
    user: "sbsdigital761@gmail.com",
    pass: "xsnn ivdi hrzr fikq",
  },
});

module.exports = {
  generateGuestId,
  Login,
  Register,
  SendOTP,
  verifyOTP,
  verifyRegistration,
  resetPassword,
};

function generateGuestId(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const key = process.env.JWT_ENCRYPTION; // Your unique key
      const currentTimeString = new Date().toISOString().replace(/\D/g, ""); // Get current time as string

      let guestId;
      let isUnique = false;

      // Generate a unique alphanumeric ID
      while (!isUnique) {
        guestId =
          key + currentTimeString + Math.random().toString(36).substr(2, 9); // Concatenate key, time string, and random characters
        // Check if the generated ID is unique in the database
        const existingUser = await Guest.findOne({ where: { guestId } });
        if (!existingUser) {
          isUnique = true;
          await Guest.create({ guestId: guestId });
        }
      }

      return resolve({ guestId });
    } catch (error) {
      reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
function Login(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const body = req.body;

      if (!body.email) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_EMAIL,
        });
      }
      if (!body.password) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_PASSWORD,
        });
      }
      if (!body.guestId) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_GUEST_ID,
        });
      }

      var [err, user] = await to(
        User.findOne({
          where: { email: body.email, userType: CONFIG.USER_TYPE_USER },
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
          message: err,
        });
      }
      if (!user) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "not registered",
        });
      }

      if (user.verified == false) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "not registered",
        });
      }

      // Check if password is correct
      if (!bcrypt.compareSync(body.password, user.password)) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "Incorrect password",
        });
      }

      if (user.guestId) {
        // Find all cart items for the received guestId
        var [errReceivedGuestCartItems, receivedGuestCartItems] = await to(
          Cart.findAll({
            where: {
              guestId: body.guestId,
            },
          })
        );

        if (errReceivedGuestCartItems) {
          return reject({
            statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
            message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
          });
        }

        // Find all cart items for the user's guestId
        var { errUserCartItems, userCartItems } = await to(
          Cart.findAll({
            where: {
              guestId: user.guestId,
            },
          })
        );

        if (errUserCartItems) {
          return reject({
            statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
            message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
          });
        }

        // Create a map to sum quantities by variantId
        const variantIdToQtyMap = {};

        // Add receivedGuestCartItems to the map
        if (receivedGuestCartItems) {
          for (const item of receivedGuestCartItems) {
            if (!variantIdToQtyMap[item.variantId]) {
              variantIdToQtyMap[item.variantId] = {
                qty: 0,
              };
            }
            variantIdToQtyMap[item.variantId].qty += parseInt(item.qty);
          }
        }

        // Add userCartItems to the map
        if (userCartItems) {
          for (const item of userCartItems) {
            if (!variantIdToQtyMap[item.variantId]) {
              variantIdToQtyMap[item.variantId] = {
                qty: 0,
              };
            }
            variantIdToQtyMap[item.variantId].qty += parseInt(item.qty);
          }
        }

        // delete cart for user

        var [errCart, cart] = await to(
          Cart.destroy({
            where: {
              guestId: user.guestId,
            },
          })
        );
        if (errCart) {
          return reject({
            statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
            message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
          });
        }

        var [errCartGuest, cartGuest] = await to(
          Cart.destroy({
            where: {
              guestId: body.guestId,
            },
          })
        );

        if (errCart) {
          return reject({
            statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
            message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
          });
        }

        // Save or update items in the database
        for (const variantId in variantIdToQtyMap) {
          const { qty } = variantIdToQtyMap[variantId];
          const [cartt, errCartt] = await to(
            Cart.create({
              guestId: user.guestId,
              qty: qty,
              variantId: variantId,
            })
          );
        }
      }

      var token = user.getJWT();
      [err, user] = await to(
        user.update(
          {
            token: token,
            guestId: user.guestId ? user.guestId : body.guestId,
          },
          {
            attributes: [
              "firstName",
              "lastName",
              "token",
              "userType",
              "gender",
              "phone",
              "status",
              "verified",
              "guestId",
            ],
          }
        )
      );

      return resolve({
        token: user.token,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        gender: user.gender,
        phone: user.phone,
        status: user.status,
        verified: user.verified,
        guestId: user.guestId,
      });
    } catch (error) {
      return reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
function Register(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const body = req.body;

      if (!body.firstName) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_FIRST_NAME,
        });
      }
      if (!body.lastName) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_LAST_NAME,
        });
      }
      if (!body.phone) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_PHONE,
        });
      }
      if (!body.email) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_EMAIL,
        });
      }
      if (!body.password) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_PASSWORD,
        });
      }
      var [err, user] = await to(
        User.findOne({
          where: { email: body.email, userType: CONFIG.USER_TYPE_USER },
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: err,
        });
      }

      if (user && user.verified) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "user already registered",
        });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(body.password, 10);

      if (user && !user.verified) {
        [err, user] = await to(
          user.update({
            email: body.email,
            phone: body.phone,
            lastName: body.lastName,
            firstName: body.firstName,
            password: hashedPassword,
          })
        );

        if (err) {
          return reject({
            statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
            message: err,
          });
        }
        if (!user) {
          return reject({
            statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
            message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
          });
        }

        return resolve("successfully registered");
      }

      [err, user] = await to(
        User.create({
          email: body.email,
          phone: body.phone,
          lastName: body.lastName,
          firstName: body.firstName,
          password: hashedPassword,
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
          message: err,
        });
      }
      if (!user) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
          message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
        });
      }

      return resolve("successfully registered");
    } catch (error) {
      return reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
function SendOTP(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const body = req.body;

      if (!body.email) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_EMAIL,
        });
      }

      var [err, user] = await to(
        User.findOne({
          where: { email: body.email, userType: CONFIG.USER_TYPE_USER },
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: err,
        });
      }

      if (!user) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "user not found",
        });
      }

      // Generate a random number between 1000 and 9999

      const generatedOTP = Math.floor(1000 + Math.random() * 9000).toString(); // Convert the number to a string

      var [errOTP, otp] = await to(
        OTP.create({ otp: generatedOTP, email: body.email })
      );

      if (errOTP) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: errOTP,
        });
      }
      if (!otp) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERR_INTERNAL_SERVER_ERROR,
        });
      }
      // Function to send OTP via email
      const mailOptions = {
        from: "sbsdigital761@gmail.com",
        to: body.email,
        subject: "Your OTP",
        text: `Your OTP is ${generatedOTP}.`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending email:", error);
        } else {
          console.log("Email sent:", info.response);
        }
      });

      return resolve("otp sent on your email");
    } catch (error) {
      return reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
function verifyRegistration(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const body = req.body;

      if (!body.email) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_EMAIL,
        });
      }
      if (!body.otp) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_OTP,
        });
      }

      var [err, otp] = await to(
        OTP.findOne({
          where: {
            email: body.email,
            otp: body.otp,
          },
          order: [["createdAt", "DESC"]],
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: err,
        });
      }

      if (!otp) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "wrong otp",
        });
      }

      // Get the current server time
      const currentServerTime = moment().tz("Asia/Kolkata"); // Change 'Asia/Kolkata' to your server's timezone

      // Convert the createdAt timestamp to the server's timezone
      const createdAt = moment(otp.createdAt).tz("Asia/Kolkata"); // Adjust timezone as per your database timezone

      // Calculate the difference in minutes between current time and createdAt time
      const differenceInMinutes = currentServerTime.diff(createdAt, "minutes");

      // If the difference is within 5 minutes, consider the OTP as valid
      if (differenceInMinutes > 5) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "otp expired",
        });
      }

      var [errUser, user] = await to(
        User.update(
          { verified: true },
          {
            where: {
              email: body.email,
              userType: CONFIG.USER_TYPE_USER,
            },
          }
        )
      );

      if (errUser) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: errUser,
        });
      }
      if (!user) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "user not found",
        });
      }

      return resolve("profile verified successfully");
    } catch (error) {
      return reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
function verifyOTP(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const body = req.body;

      if (!body.email) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_EMAIL,
        });
      }
      if (!body.otp) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_OTP,
        });
      }

      var [err, otp] = await to(
        OTP.findOne({
          where: {
            email: body.email,
            otp: body.otp,
          },
          order: [["createdAt", "DESC"]],
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: err,
        });
      }

      if (!otp) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "wrong otp",
        });
      }

      // Get the current server time
      const currentServerTime = moment().tz("Asia/Kolkata"); // Change 'Asia/Kolkata' to your server's timezone

      // Convert the createdAt timestamp to the server's timezone
      const createdAt = moment(otp.createdAt).tz("Asia/Kolkata"); // Adjust timezone as per your database timezone

      // Calculate the difference in minutes between current time and createdAt time
      const differenceInMinutes = currentServerTime.diff(createdAt, "minutes");

      // If the difference is within 5 minutes, consider the OTP as valid
      if (differenceInMinutes > 5) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "otp expired",
        });
      }
      return resolve("otp verified");
    } catch (error) {
      return reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
function resetPassword(req, res) {
  return new Promise(async function (resolve, reject) {
    try {
      const body = req.body;

      if (!body.email) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_EMAIL,
        });
      }
      if (!body.password) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: CONFIG.ERROR_MISSING_PASSWORD,
        });
      }
      // Hash the password
      var [err, user] = await to(
        User.findOne({
          where: {
            email: body.email,
            userType: CONFIG.USER_TYPE_USER,
          },
        })
      );

      if (err) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: err,
        });
      }

      if (!user) {
        return reject({
          statusCode: CONFIG.STATUS_CODE_BAD_REQUEST,
          message: "user not registered",
        });
      }

      const hashedPassword = await bcrypt.hash(body.password, 10);

      await user
        .update({ password: hashedPassword })
        .then((result) => {
          return resolve("password changed successfully");
        })
        .catch((err) => {
          return reject({
            statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
            message: err,
          });
        });
    } catch (error) {
      return reject({
        statusCode: CONFIG.STATUS_CODE_INTERNAL_SERVER,
        message: error,
      });
    }
  });
}
