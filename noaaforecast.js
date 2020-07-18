Module.register("noaaforecast", {

    defaults: {
        lat: config.lat,
        lon: config.lon,

        notificationsOnly: false,
        units: config.units,
        language: config.language,
        updateInterval: 5 * 60 * 1000, // every 5 minutes
        animationSpeed: 1000,
        initialLoadDelay: 3, // 0 seconds delay
        retryDelay: 2500,
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

    NOTIFICATION_GRIDPOINT_DATA: "NOAAWEATHER_GRIDPOINT_DATA",
    NOTIFICATION_FORECAST_DATA: "NOAAWEATHER_FORECAST_DATA",
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
        return ["font-awesome.css", "weather-icons.css", "weather-icons-wind.css", "noaaforecast.css"];
    },

    start: function () {
        Log.info("Starting module: " + this.name);

        this.officeWeather = null;
        this.weatherData = null;

        if(!this.config.notificationsOnly){
            this.scheduleUpdate(this.config.initialLoadDelay);
        }
    },

    makeRequest: function(method, url, self){
        return new Promise(function(resolve, reject){
            var request = new XMLHttpRequest();
            request.open(method, url, true);

            request.onload = function () {
                if ( this.status === 200 ){
                    resolve(JSON.parse(request.response));
                }
                else{
                    self.scheduleUpdate(self.loaded ? -1 : self.config.retryDelay);

                    // Log.log("HTTP response was invalid: " + this.status + " " + request.statusText);
                    reject({
                        status: this.status,
                        statusText: request.statusText,
                        error: "Non-OK HTTP status",
                    });
                }
            };

            request.onerror = function(){
                // self.scheduleUpdate(self.loaded ? -1 : self.config.retryDelay);

                // Log.log("Error making request: " + this.status + " " + err);
                reject({
                    status: this.status,
                    statusText: request.statusText,
                    error: err,
                });
            };

            request.send();
        });
    },

    updateWeather: function () {
        if ( this.config.notificationsOnly ){
            Log.log("Notification-only mode; waiting for notifications from another noaa module.");
            return;
        }

        if ( typeof this.officeWeather == "undefined" || this.officeWeather == null ){
            Log.log("Waiting for gridpoint office data before we can update weather...");
            this.scheduleUpdate(this.loaded ? -1 : this.config.retryDelay);

            return;
        }

        Log.log("Looking up forecast from office URL: " + this.officeWeather.properties.forecast);

        var url = this.officeWeather.properties.forecast;
        var self = this;

        this.makeRequest("GET", url, self).then((response)=>{
            this.forecastData = response;
            self.processWeather();
        })
        .catch(function(err){
            self.updateDom(self.config.animationSpeed);
            Log.error("Failed to load NOAA forecast from: " + url + ": " + err.error);
        });
    },

    updateOfficeWeather: function(){
        if ( this.config.notificationsOnly ){
            Log.log("Notification-only mode; waiting for notifications from another noaa module.");
            return;
        }

        if ( this.officeWeather != null ){
            Log.log("We already have gridpoint office info...updating weather");
            this.updateWeather();
        }

        // Log.log("Looking up NOAA weather by lat/long");

        var url = this.config.apiBase + '/points/' + this.config.lat + "," + this.config.lon;
        var self = this;
        var retry = true;

        var officePromise = this.makeRequest("GET", url, self)
                                .then(function(response){
                                    self.officeWeather = response;
                                    self.updateWeather();
                                })
                                .catch(function(err){
                                    self.updateDom(self.config.animationSpeed);
                                    retry = true;
                                    Log.error("Failed to load NOAA office information for Lat/Lon: " + 
                                                self.config.lat + "," + self.config.lon + ": " + err.status + " " + err.statusText);
                                });

        // Promise.all([officePromise]).then((values)=>{
        //     // Log.log("All prelim promises done, with values: " + values);
        // })
    },

    alignPeriods: function(periods){
        let current = null;
        var result = [];

        for(let i=0; i<periods.length;i++){
            let period = periods[i];

            if(period.isDaytime && current != null){
                current.minTemp = Math.min(current.minTemp, parseFloat(period.temperature));
                current.maxTemp = Math.max(current.maxTemp, parseFloat(period.temperature));
                current.precip = Math.max(current.precip, this.parsePrecipProbability(period));

                let wind = {
                    speed: this.parseWindSpeed(period),
                    direction: period.windDirection,
                };

                let prevailingWindSpeed = Math.max(current.wind.speed, wind.speed);
                wind = prevailingWindSpeed == wind.speed ? wind : current.wind;
                current.wind = wind;

                let weatherIcon = this.parseWeatherIcon(period);
                if(current.weatherIcon == null ){
                    current.weatherIcon = weatherIcon;
                }
                else if ( weatherIcon != null ){
                    current.weatherIcon = weatherIcon[1] > current.weatherIcon[1] ? weatherIcon : current.weatherIcon;
                }


                result.push(current);
                current = null;
            }
            else if (!period.isDaytime){

                // var dayText = new Date(Date.parse(period.endTime));
                // dayText = moment.weekdaysShort(dayText.getDay()); // + " " + (measurement.isDaytime?"&nbsp;":"night");

                let dayText = this.getDayFromTime(period);

                let windSpeed = this.parseWindSpeed(period);
                let wind = {speed: windSpeed, direction: period.windDirection};

                let weatherIcon = this.parseWeatherIcon(period);
                let precip = this.parsePrecipProbability(period);

                current = {
                    minTemp: period.temperature,
                    maxTemp: period.temperature,
                    precip: precip,
                    wind: wind,
                    dayText: dayText,
                    weatherIcon: weatherIcon,
                };
            }
        }

        return result;
    },

    getDayFromTime: function(measurement) {
        var dt = new Date(Date.parse(measurement.endTime));
        return moment.weekdaysShort(dt.getDay()); // + " " + (measurement.isDaytime?"&nbsp;":"night");
    },

    parseWindSpeed: function(data){
        if ( data.windSpeed == null || data.windSpeed.length < 1 ){
            return 0;
        }

        return parseInt(data.windSpeed.split(" ")[0]);
    },

    parsePrecipProbability: function(data){
        var iconData = data.icon.split('/');
        iconData = iconData[iconData.length-1];
        iconData = iconData.split('?')[0];
        iconData = iconData.split(',');

        var prob = 0;
        if(iconData.length > 1){
            prob = parseInt(iconData[1]);
        }

        return prob;
    },

    parseWeatherIcon: function(data){
        var classifier = data.icon.split("/");
        classifier = classifier[classifier.length-1].split("?")[0].split(",")[0];

        // Log.log("Weather classifier is: " + classifier);

        var conditions = {
            "skc": ["sunny", 0],
            "few": ["sunny", 0],
            "sct": ["sunny-overcast", 10],
            "bkn": ["sunny-overcast", 10],
            "ovc": ["cloudy", 20],
            "wind_skc": ["windy", 30],
            "wind_few": ["windy", 30],
            "wind_sct": ["cloudy-windy", 40],
            "wind_bkn": ["cloudy-windy", 40],
            "wind_ovc": ["cloudy-windy", 40],
            "snow": ["snow", 50],
            "rain_snow": ["rain-mix", 60],
            "rain_sleet": ["sleet", 60],
            "snow_sleet": ["sleet", 60],
            "fzra": ["rain-mix", 60],
            "rain_fzra": ["rain-mix", 60],
            "snow_fzra": ["rain-mix", 60],
            "sleet": ["sleet", 60],
            "rain": ["rain", 50],
            "rain_showers": ["showers", 45],
            "rain_showers_hi": ["showers", 45],
            "tsra": ["thunderstorm", 60],
            "tsra_sct": ["thunderstorm", 60],
            "tsra_hi": ["thunderstorm", 60],
            "tornado": ["wi-tornado", 1000],
            "hurricane": ["wi-hurricane-warning", 900],
            "tropical_storm": ["wi-hurricane", 800],
            "dust": ["wi-dust", 200],
            "smoke": ["wi-smoke", 300],
            "haze": ["wi-haze", 65],
            "hot": ["wi-hot", 65],
            "cold": ["wi-cold", 65],
            "blizzard": ["snow-wind", 75],
            "fog": ["fog", 55],
        };

        return conditions[classifier];
    },

    processWeather: function () {
        if (this.officeWeather == null || this.forecastData == null ){
            Log.log("We don't have all the data we need for a weather update; waiting...");
            return;
        }

        var officeData = this.officeWeather;
        var data = this.forecastData;

        if (this.config.debug) {
            console.log('weather data', data);
        }

        var periods = this.alignPeriods(data.properties.periods);
        this.weatherData = {daily: {data: periods}};

        this.loaded = true;

        this.updateDom(this.config.animationSpeed);

        this.scheduleUpdate();

        if(!this.config.notificationsOnly){
            this.sendNotification(this.NOTIFICATION_GRIDPOINT_DATA.toString(), { data: officeData });
            this.sendNotification(this.NOTIFICATION_FORECAST_DATA.toString(), { data: data });
        }
    },

    processWeatherError: function (error) {
        if (this.config.debug) {
            console.log('process weather error', error);
        }
        // try later

        this.scheduleUpdate();
    },

    notificationReceived: function(notification, payload, sender) {
        // Log.log("noaaforecast RECV: " + notification + " from: " + JSON.stringify(sender.name));
        switch(notification) {
            case "DOM_OBJECTS_CREATED":
                break;
            case "INDOOR_TEMPERATURE":
                if (this.config.showIndoorTemperature) {
                  this.roomTemperature = payload;
                  this.updateDom(this.config.animationSpeed);
                }
                break;
            case "NOAAWEATHER_GRIDPOINT_DATA":
                this.officeWeather = payload;
                Log.log("RECV: " + notification);
                if ( this.officeWeather!= null && this.forecastData != null ){
                    Log.log("Looks like we have all we need to process the weather!");
                    this.processWeather();
                }
                break;

            case "NOAAWEATHER_FORECAST_DATA":
                this.forecastData = payload;
                Log.log("RECV: " + notification);
                if ( this.officeWeather != null && this.forecastData != null ){
                    Log.log("Looks like we have all we need to process the weather!");
                    this.processWeather();
                }
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
        var total = max - min;
        var interval = 100 / total;
        var rowMinTemp = this.roundTemp(data.minTemp);
        var rowMaxTemp = this.roundTemp(data.maxTemp);

        var row = document.createElement("tr");
        row.className = "forecast-row" + (addClass ? " " + addClass : "");

        var dayTextSpan = document.createElement("span");
        dayTextSpan.className = "forecast-day"
        dayTextSpan.innerHTML = data.dayText;

        var iconClass = data.weatherIcon;
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
        windBearing.className = "wi wi-wind from-" + data.wind.direction.toLowerCase();
        wind.appendChild(windBearing);

        var cardinalDirection = data.wind.direction;

        var windSpeed = document.createElement("span");
        if (this.config.units === 'metric') {
          var windSpeedUnit = "m/s";
        } else {
          var windSpeedUnit = "mph";
        }

        windSpeed.innerHTML = " " + cardinalDirection + " " + data.wind.speed + windSpeedUnit;
        wind.appendChild(windSpeed);

        var dayPrecipProb = document.createElement("span");
        dayPrecipProb.className = "forecast-precip-prob";

        var precipProbability = data.precip;

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

    getDayOfYear: function(tstamp_ms){
        var firstday = Math.floor(new Date().setFullYear(new Date().getFullYear(),0,1) / this.ONE_DAY_IN_MS);
        var day = Math.ceil(tstamp_ms / this.ONE_DAY_IN_MS);
        return day - firstday;
    },

    renderWeatherForecast: function () {
        var numRows =  this.config.maxDaysForecast;
        var i;

        var filteredRows = this.weatherData.daily.data.filter( function(d, i) { return (i < numRows); });

        var min = Number.MAX_VALUE;
        var max = -Number.MAX_VALUE;
        for (i = 0; i < filteredRows.length; i++) {
            var row = filteredRows[i];
            max = Math.max(max, row.maxTemp);
            min = Math.min(min, row.minTemp);
        }
        min = Math.round(min);
        max = Math.round(max);

        var display = document.createElement("table");
        display.className = this.config.forecastTableFontSize + " forecast";
        for (i = 0; i < filteredRows.length; i++) {
            var day = filteredRows[i];
            var addClass = "";
            if(this.config.fadeForecast) {
                if(i+2 == filteredRows.length) {
                    addClass = "dark";
                }
                if(i+1 == filteredRows.length) {
                    addClass = "darker";
                }
            }
            var row = this.renderForecastRow(day, min, max, addClass);
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

    scheduleUpdate: function(delay) {
        var nextLoad = this.config.updateInterval;
        if (typeof delay !== "undefined" && delay >= 0) {
            nextLoad = delay;
        }

        var self = this;

        setTimeout(function() {
            self.updateOfficeWeather();
        }, nextLoad);
    }

});
