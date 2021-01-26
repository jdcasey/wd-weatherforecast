Module.register("noaaforecast", {

    defaults: {
        units: config.units,
        language: config.language,
        animationSpeed: 1000,
        showDailyPrecipitationChance: true,
        showIndoorTemperature: false,
        showTextSummary: true,
        showWind: false,
        showSunriseSunset: true,
        showForecast: true,
        fadeForecast: false,
        forecastTableFontSize: 'medium',
        maxDaysForecast: 7,   // maximum number of days to show in forecast
        tempDecimalPlaces: 0,

        apiBase: "https://api.weather.gov",
        debug: false
    },

    ONE_DAY_IN_MS: 86400000,

    getTranslations: function () {
        return false;
    },

    getScripts: function () {
        return [
          'moment.js'
        ];
    },

    getStyles: function () {
        return [
          "font-awesome.css", "weather-icons.css", "weather-icons-wind.css", "noaaforecast.css"
        ];
    },

    start: function () {
        Log.info("Starting module: " + this.name);

        // Set locale.
        moment.locale(config.language);

        this.weatherData = null;
    },

    getDayFromTime: function(measurement) {
        var dt = new Date(Date.parse(measurement.endTime));
        return moment.weekdaysShort(dt.getDay()); // + " " + (measurement.isDaytime?"&nbsp;":"night");
    },

    processWeather: function () {
        if (this.weatherData === null ){
            Log.log("We don't have all the data we need for a weather update; waiting...");
            return;
        }

        var data = this.weatherData;

        if (this.config.debug) {
            console.log('weather data', data);
        }

        this.loaded = true;

        this.updateDom(this.config.animationSpeed);
    },

    notificationReceived: function(notification, payload, sender) {
        // Log.log("noaaforecast RECV: " + notification + " from: " + JSON.stringify(sender.name));
        switch(notification) {
            case "DOM_OBJECTS_CREATED":
                break;
            case "WEATHER_REFRESHED":
                this.weatherData = payload;
                Log.log("RECV: " + notification);
                this.processWeather();
                break;
      }
    },

    getDom: function() {
        var wrapper = document.createElement("div");

        if (!this.loaded) {
          wrapper.innerHTML = this.translate('LOADING');
          wrapper.className = "dimmed light small";
          return wrapper;
      }

      wrapper.appendChild(this.renderWeatherForecast());

      return wrapper;
    },

    renderForecastRow: function (data, min, max, addClass) {
        const total = max - min;
        const interval = 100 / total;
        const rowMinTemp = this.roundTemp(data.temp.min);
        const rowMaxTemp = this.roundTemp(data.temp.max);

        const row = document.createElement("tr");
        row.className = "forecast-row" + (addClass ? " " + addClass : "");

        const dayTextSpan = document.createElement("span");
        dayTextSpan.className = "forecast-day"
        dayTextSpan.innerHTML = moment(data.dt * 1000).format("ddd");

        var iconClass = data.weather[0].weatherClass;
        if ( iconClass != null ){
            iconClass = iconClass[0];

            if ( !iconClass.startsWith('wi-') ){
                iconClass = 'wi-day-' + iconClass;
            }
        }

        var icon = document.createElement("span");
        icon.className = 'wi weathericon ' + iconClass;

        var wind = document.createElement("div");
        wind.className = "small dimmed wind";

        var windBearing = document.createElement("span");
        windBearing.className = "wi wi-wind from-" + data.windDirection.toLowerCase();
        wind.appendChild(windBearing);

        var cardinalDirection = data.windDirection;

        var windSpeed = document.createElement("span");
        if (this.weatherData.config.units === 'metric') {
          var windSpeedUnit = "m/s";
        } else {
          var windSpeedUnit = "mph";
        }

        windSpeed.innerHTML = " " + cardinalDirection + " " + Math.round(data.wind_speed) + windSpeedUnit;
        wind.appendChild(windSpeed);

        var dayPrecipProb = document.createElement("span");
        dayPrecipProb.className = "forecast-precip-prob";

        var precipProbability = data.pop * 100;

        // if (precipProbability > 0) {
            dayPrecipProb.innerHTML = precipProbability + "%";
        // }
        // else {
        //     dayPrecipProb.innerHTML = "&nbsp;";
        // }

        var forecastBar = document.createElement("div");
        forecastBar.className = "forecast-bar";

        var minTemp = document.createElement("span");
        minTemp.innerHTML = rowMinTemp + "&deg;";
        minTemp.className = "temp min-temp";

        var maxTemp = document.createElement("span");
        maxTemp.innerHTML = rowMaxTemp + "&deg;";
        maxTemp.className = "temp max-temp";

        var bar = document.createElement("span");
        bar.className = "bar";
        bar.innerHTML = "&nbsp;";
        var barWidth = Math.round(interval * (rowMaxTemp - rowMinTemp));
        bar.style.width = barWidth + '%';

        var leftSpacer = document.createElement("span");
        leftSpacer.style.width = (interval * (rowMinTemp - min)) + "%";
        var rightSpacer = document.createElement("span");
        rightSpacer.style.width = (interval * (max - rowMaxTemp)) + "%";

        forecastBar.appendChild(leftSpacer);
        forecastBar.appendChild(minTemp);
        forecastBar.appendChild(bar);
        forecastBar.appendChild(maxTemp);
        forecastBar.appendChild(rightSpacer);

        var forecastBarWrapper = document.createElement("td");
        forecastBarWrapper.appendChild(forecastBar);

        row.appendChild(dayTextSpan);
        row.appendChild(icon);
        if (this.config.showDailyPrecipitationChance) {
            row.appendChild(dayPrecipProb);
        }

        if (this.config.showWind) {
            row.appendChild(wind);
        }

        row.appendChild(forecastBarWrapper);

        return row;
    },

    renderWeatherForecast: function () {
        const numRows =  this.config.maxDaysForecast;
        const filteredRows = this.weatherData.daily.filter( function(d, i) { return (i < numRows); });

        let min = Number.MAX_VALUE;
        let max = -Number.MAX_VALUE;
        for (let i = 0; i < filteredRows.length; i++) {
            const row = filteredRows[i];
            max = Math.max(max, row.temp.max);
            min = Math.min(min, row.temp.min);
        }
        min = Math.round(min);
        max = Math.round(max);

        const display = document.createElement("table");
        display.className = this.config.forecastTableFontSize + " forecast";
        for (i = 0; i < filteredRows.length; i++) {
            const day = filteredRows[i];
            let addClass = "";
            if(this.config.fadeForecast) {
                if(i+2 == filteredRows.length) {
                    addClass = "dark";
                }
                if(i+1 == filteredRows.length) {
                    addClass = "darker";
                }
            }
            const row = this.renderForecastRow(day, min, max, addClass);
            display.appendChild(row);
        }
        return display;
    },

    // Round the temperature based on tempDecimalPlaces
    roundTemp: function (temp) {
        var scalar = 1 << this.config.tempDecimalPlaces;

        temp *= scalar;
        temp  = Math.round( temp );
        temp /= scalar;

        return temp;
    },

});
